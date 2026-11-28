import type { Provider } from '@dw/billing';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { ModelResolver } from './models.ts';

/**
 * Fake models for tests (spec llm-gateway "Mô hình giả cho test"): fixed text and
 * token counts, no network. Never used outside tests.
 */
export type FakeReply = {
  readonly text?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Throw an APICallError with this HTTP status instead of answering. */
  readonly failWithStatus?: number;
  /** Ask for these tools instead of (or next to) answering with text. */
  readonly toolCalls?: ReadonlyArray<{ readonly toolName: string; readonly input: unknown }>;
  /** Answer after this long; an aborted call rejects without usage (never charged). */
  readonly delayMs?: number;
};

/** What the gateway sent to the fake model on one call. */
export type FakeRequest = {
  readonly prompt: unknown;
  readonly toolNames: readonly string[];
};

export type FakeCall = {
  readonly provider: Provider;
  readonly modelId: string;
  readonly apiKey: string;
};

export type FakeModels = ModelResolver & {
  /** Every resolve() so far: proves whether the provider would have been reached. */
  readonly calls: FakeCall[];
  /** Reply for the next calls (default: 1.000 in / 500 out). */
  reply: FakeReply;
  /** Replies used first, one per call, in order; then `reply`. */
  script: FakeReply[];
  /** Prompt and tool names of every call that reached the model. */
  readonly requests: FakeRequest[];
};

export function createFakeModels(initial?: FakeReply): FakeModels {
  const fake: FakeModels = {
    calls: [],
    reply: initial ?? { text: 'Xin chào', inputTokens: 1000, outputTokens: 500 },
    script: [],
    requests: [],
    resolve(provider, modelId, apiKey) {
      fake.calls.push({ provider, modelId, apiKey });
      const reply = fake.script.shift() ?? fake.reply;
      return new MockLanguageModelV4({
        provider,
        modelId,
        doGenerate: async (options) => {
          fake.requests.push({
            prompt: options.prompt,
            toolNames: (options.tools ?? []).map((tool) => tool.name),
          });
          if (reply.delayMs) await wait(reply.delayMs, options.abortSignal);
          if (reply.failWithStatus) {
            throw new APICallError({
              message: `fake ${reply.failWithStatus}`,
              url: `https://fake.invalid/${provider}`,
              requestBodyValues: { apiKey },
              statusCode: reply.failWithStatus,
              responseHeaders: { 'x-echo-key': apiKey },
              isRetryable: false,
            });
          }
          const cacheRead = reply.cacheReadTokens ?? 0;
          const cacheWrite = reply.cacheWriteTokens ?? 0;
          const calls = (reply.toolCalls ?? []).map((call, index) => ({
            type: 'tool-call' as const,
            toolCallId: `call-${fake.calls.length}-${index}`,
            toolName: call.toolName,
            input: JSON.stringify(call.input),
          }));
          const text =
            reply.text === undefined && calls.length > 0
              ? []
              : [{ type: 'text' as const, text: reply.text ?? 'Xin chào' }];
          return {
            content: [...text, ...calls],
            finishReason:
              calls.length > 0
                ? { unified: 'tool-calls', raw: 'tool_use' }
                : { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: {
                total: reply.inputTokens + cacheRead + cacheWrite,
                noCache: reply.inputTokens,
                cacheRead,
                cacheWrite,
              },
              outputTokens: { total: reply.outputTokens, text: reply.outputTokens, reasoning: 0 },
            },
            warnings: [],
          };
        },
      });
    },
  };
  return fake;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}
