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
};

export function createFakeModels(initial?: FakeReply): FakeModels {
  const fake: FakeModels = {
    calls: [],
    reply: initial ?? { text: 'Xin chào', inputTokens: 1000, outputTokens: 500 },
    resolve(provider, modelId, apiKey) {
      fake.calls.push({ provider, modelId, apiKey });
      const reply = fake.reply;
      return new MockLanguageModelV4({
        provider,
        modelId,
        doGenerate: async () => {
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
          return {
            content: [{ type: 'text', text: reply.text ?? 'Xin chào' }],
            finishReason: { unified: 'stop', raw: 'stop' },
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
