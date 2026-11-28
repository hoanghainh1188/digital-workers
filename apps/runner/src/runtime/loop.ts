import type { Provider } from '@dw/billing';
import { checkTaskLimits, type LimitReason, type TaskLimits } from '@dw/core';
import { type Database, type EffectiveSkill, recordStep, withCompany } from '@dw/db';
import type { ModelMessage, ToolSet } from '@dw/llm';
import {
  CreditExhaustedError,
  type Gateway,
  ModelNotPricedError,
  ProviderCallError,
  UsageNotRecordedError,
} from '@dw/llm';
import { runSkillTool, SKILL_TOOL_NAMES } from './skill-tools.ts';

export interface LoopLogger {
  readonly info: (details: object, message: string) => void;
  readonly warn: (details: object, message: string) => void;
  readonly error: (details: object, message: string) => void;
}

export interface LoopInput {
  readonly companyId: string;
  readonly workerId: string;
  readonly taskId: string;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly skills: readonly EffectiveSkill[];
  readonly tools: ToolSet;
  /** When the Task started (process clock: only for the time limit). */
  readonly startedAtMs: number;
}

export interface LoopDeps {
  readonly database: Pick<Database, 'db'>;
  readonly gateway: Gateway;
  readonly model: { readonly provider: Provider; readonly id: string };
  readonly limits: TaskLimits;
  readonly logger: LoopLogger;
  readonly now?: () => number;
  readonly maxOutputTokens?: number;
}

export type LoopResult =
  | { readonly kind: 'answer'; readonly text: string; readonly steps: number }
  | {
      readonly kind: 'stopped';
      readonly reason: LimitReason | 'credit_exhausted';
      /** Text the model produced in its last step, sent along with the notice (D6). */
      readonly partialText: string;
      readonly steps: number;
    }
  | { readonly kind: 'failed'; readonly steps: number }
  /** Not running any more (ended by the reaper): the caller must not reply. */
  | { readonly kind: 'lost'; readonly steps: number };

/**
 * The model ⇄ tool loop of one Task (design D6). One step = one gateway call. Limits are
 * checked before every call; the time limit also aborts the call in flight. The runtime
 * loops itself (the gateway never does) so limits, cost and tools stay in our code.
 */
export async function runLoop(deps: LoopDeps, input: LoopInput): Promise<LoopResult> {
  const now = deps.now ?? Date.now;
  const messages: ModelMessage[] = [...input.messages];
  const known = new Set<string>(SKILL_TOOL_NAMES);
  let steps = 0;
  let chargeVnd = 0;
  let partialText = '';

  const remaining = deps.limits.maxMs - (now() - input.startedAtMs);
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error('task time limit')),
    Math.max(0, remaining),
  );
  const log = { companyId: input.companyId, workerId: input.workerId, taskId: input.taskId };

  try {
    for (;;) {
      const limit = checkTaskLimits(
        { steps, chargeVnd, startedAtMs: input.startedAtMs },
        deps.limits,
        now(),
      );
      if (limit) return { kind: 'stopped', reason: limit, partialText, steps };

      let result: Awaited<ReturnType<Gateway['generate']>>;
      try {
        result = await deps.gateway.generate({
          companyId: input.companyId,
          workerId: input.workerId,
          taskId: input.taskId,
          model: deps.model,
          system: input.system,
          messages,
          tools: input.tools,
          maxOutputTokens: deps.maxOutputTokens ?? 2048,
          abortSignal: deadline.signal,
        });
      } catch (error) {
        if (deadline.signal.aborted) {
          // Not charged by us; the provider may have billed it (design Risks).
          deps.logger.warn(log, 'model call aborted');
          return { kind: 'stopped', reason: 'max_seconds', partialText, steps };
        }
        if (error instanceof CreditExhaustedError) {
          return { kind: 'stopped', reason: 'credit_exhausted', partialText, steps };
        }
        if (error instanceof ModelNotPricedError) {
          deps.logger.warn(
            { ...log, provider: error.provider, model: error.model },
            'worker model has no price: set it in /platform/prices',
          );
        } else {
          deps.logger.error(
            { ...log, error: errorName(error), ...providerCode(error) },
            'task step failed',
          );
        }
        return { kind: 'failed', steps };
      }

      steps += 1;
      chargeVnd += result.chargeVnd;
      partialText = result.text;
      const stillOurs = await withCompany(deps.database, input.companyId, (tx) =>
        recordStep(tx, input.taskId, result.chargeVnd),
      );
      // The reaper ended this Task (heartbeat lost): stop at once, reply nothing (D9).
      if (!stillOurs) return { kind: 'lost', steps };
      if (result.toolCalls.length === 0) return { kind: 'answer', text: result.text, steps };

      messages.push({
        role: 'assistant',
        content: [
          ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
          ...result.toolCalls.map((call) => ({
            type: 'tool-call' as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        ],
      });
      const outputs = await withCompany(deps.database, input.companyId, async (tx) => {
        const results = [];
        for (const call of result.toolCalls) {
          // A tool outside the list built in code is never run (spec "Tool do code quyết định").
          const output = known.has(call.toolName)
            ? await runSkillTool(tx, input.skills, call.toolName, call.input)
            : await runSkillTool(tx, input.skills, '', call.input);
          results.push({ call, output });
        }
        return results;
      });
      messages.push({
        role: 'tool',
        content: outputs.map(({ call, output }) => ({
          type: 'tool-result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: output.ok
            ? { type: 'text' as const, value: output.text }
            : { type: 'error-text' as const, value: output.text },
        })),
      });
    }
  } catch (error) {
    deps.logger.error({ ...log, error: errorName(error) }, 'task loop failed');
    return { kind: 'failed', steps };
  } finally {
    clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  if (error instanceof UsageNotRecordedError) return error.name;
  return error instanceof Error ? error.name : 'unknown';
}

function providerCode(error: unknown): { code?: string; status?: number | null } {
  return error instanceof ProviderCallError ? { code: error.code, status: error.status } : {};
}
