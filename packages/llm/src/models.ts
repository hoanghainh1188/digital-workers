import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { Provider, TokenUsage } from '@dw/billing';
import type { LanguageModel, LanguageModelUsage } from 'ai';

/**
 * Turns (provider, model id, API key) into an AI SDK model (design D6). Adding a
 * provider = one branch here + its prices in the DB (NFR-09); callers do not change.
 */
export type ModelResolver = {
  readonly resolve: (provider: Provider, modelId: string, apiKey: string) => LanguageModel;
};

export const providerModels: ModelResolver = {
  resolve(provider, modelId, apiKey) {
    switch (provider) {
      case 'anthropic':
        return createAnthropic({ apiKey })(modelId);
      case 'openai':
        return createOpenAI({ apiKey })(modelId);
    }
  },
};

/**
 * Billable token counts from AI SDK usage (design D6 step 5). AI SDK 7 reports
 * `inputTokens` as the total including cache reads and writes, with the split in
 * `inputTokenDetails`; both providers fill it. Input billed at the input price is the
 * uncached part only, so nothing is charged twice.
 */
export function readUsage(usage: LanguageModelUsage): TokenUsage {
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const total = usage.inputTokens ?? 0;
  const noCache =
    usage.inputTokenDetails?.noCacheTokens ?? total - cacheReadTokens - cacheWriteTokens;
  return {
    inputTokens: Math.max(0, noCache),
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}
