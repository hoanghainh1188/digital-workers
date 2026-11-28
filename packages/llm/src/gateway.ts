import {
  dispatchBalanceEvents,
  effectivePrice,
  type Notifier,
  type Provider,
  readBalance,
  recordUsage,
  silentNotifier,
  type TokenUsage,
} from '@dw/billing';
import type { Database } from '@dw/db';
import { APICallError, generateText, type ModelMessage, RetryError, type ToolSet } from 'ai';
import {
  CreditExhaustedError,
  ModelNotPricedError,
  NoCompanyError,
  ProviderCallError,
  UsageNotRecordedError,
} from './errors.ts';
import type { ProviderKeyStore } from './keys.ts';
import { type ModelResolver, readUsage } from './models.ts';

/** The subset of a pino / Fastify logger the gateway uses. */
export type GatewayLogger = {
  readonly info: (details: object, message: string) => void;
  readonly warn: (details: object, message: string) => void;
  readonly error: (details: object, message: string) => void;
};

export type GatewayDeps = {
  readonly database: Pick<Database, 'db'>;
  readonly keys: Pick<ProviderKeyStore, 'get'>;
  readonly models: ModelResolver;
  readonly logger: GatewayLogger;
  readonly notifier?: Notifier;
  readonly now?: () => Date;
  /** Retries of retryable provider errors (AI SDK default 2). Tests use 0. */
  readonly maxRetries?: number;
};

export type GenerateRequest = {
  /** From the job's context (a Task, a chat), never from user input (spec llm-gateway). */
  readonly companyId: string;
  readonly workerId?: string | null;
  readonly taskId?: string | null;
  readonly model: { readonly provider: Provider; readonly id: string };
  readonly messages: ModelMessage[];
  readonly system?: string;
  readonly tools?: ToolSet;
  readonly maxOutputTokens: number;
  readonly abortSignal?: AbortSignal;
};

export type GenerateResult = {
  readonly text: string;
  readonly toolCalls: ReadonlyArray<{ toolCallId: string; toolName: string; input: unknown }>;
  readonly finishReason: string;
  readonly usage: TokenUsage;
  /** Whole đồng debited for this call. */
  readonly chargeVnd: number;
  readonly costEntryId: string;
};

export type Gateway = {
  readonly generate: (request: GenerateRequest) => Promise<GenerateResult>;
};

/**
 * The single door to model providers (design D6, spec llm-gateway). Order:
 * price → balance → key → call → usage → ledger → notifications. A call that fails
 * before the provider returns usage is never charged.
 */
export function createGateway(deps: GatewayDeps): Gateway {
  const now = deps.now ?? (() => new Date());
  const notifier = deps.notifier ?? silentNotifier;

  return Object.freeze({
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      if (!request.companyId) throw new NoCompanyError();
      const { provider, id: modelId } = request.model;
      const at = now();

      const price = await effectivePrice(deps.database.db, provider, modelId, at);
      if (!price) throw new ModelNotPricedError(provider, modelId);
      if ((await readBalance(deps.database, request.companyId)) <= 0) {
        throw new CreditExhaustedError();
      }
      const apiKey = await deps.keys.get(provider);

      let result: Awaited<ReturnType<typeof generateText>>;
      try {
        result = await generateText({
          model: deps.models.resolve(provider, modelId, apiKey),
          messages: request.messages,
          ...(request.system ? { system: request.system } : {}),
          ...(request.tools ? { tools: request.tools } : {}),
          maxOutputTokens: request.maxOutputTokens,
          maxRetries: deps.maxRetries ?? 2,
          ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
        });
      } catch (error) {
        const failure = new ProviderCallError(provider, statusOf(error));
        // Only our own error fields: the SDK error carries the request (and headers).
        deps.logger.warn(
          { provider, model: modelId, code: failure.code, status: failure.status },
          'model call failed',
        );
        throw failure;
      }

      const usage = readUsage(result.totalUsage);
      const input = {
        companyId: request.companyId,
        workerId: request.workerId ?? null,
        taskId: request.taskId ?? null,
        price,
        usage,
        at,
      };
      let record: Awaited<ReturnType<typeof recordUsage>> | undefined;
      for (let attempt = 1; !record; attempt += 1) {
        try {
          record = await recordUsage(deps.database, input);
        } catch (error) {
          if (attempt < RECORD_ATTEMPTS) continue;
          // The provider has been paid: keep enough to bill this call by hand.
          deps.logger.error(
            {
              companyId: request.companyId,
              workerId: input.workerId,
              taskId: input.taskId,
              provider,
              model: modelId,
              priceId: price.id,
              at: at.toISOString(),
              usage,
              error: errorName(error),
            },
            'model call not recorded',
          );
          throw new UsageNotRecordedError();
        }
      }
      dispatchBalanceEvents(notifier, request.companyId, record.events, (error) =>
        deps.logger.error({ error: errorName(error) }, 'credit notification failed'),
      );
      return {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
        finishReason: result.finishReason,
        usage,
        chargeVnd: record.debitVnd,
        costEntryId: record.costEntryId,
      };
    },
  });
}

/** Ledger writes for a finished call: first try + retries (deadlock, dropped connection). */
const RECORD_ATTEMPTS = 3;

/** HTTP status of a provider failure (also inside an AI SDK RetryError), else null. */
function statusOf(error: unknown): number | null {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(last) ? (last.statusCode ?? null) : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
