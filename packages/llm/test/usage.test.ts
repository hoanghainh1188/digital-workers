import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUsage } from '../src/models.ts';
import { verifyProviderKey } from '../src/verify.ts';

/**
 * Task 5.5: how the installed AI SDK reports cache tokens, checked through the real
 * provider packages with a canned HTTP response (no network: global fetch throws).
 */

afterEach(() => vi.unstubAllGlobals());

function cannedFetch(body: unknown) {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

describe('readUsage with the installed providers', () => {
  it('Anthropic: input_tokens excludes cache; cache read + write come separately', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network is disabled in tests')));
    const anthropic = createAnthropic({
      apiKey: 'sk-ant-test',
      fetch: cannedFetch({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 10_000,
          cache_creation_input_tokens: 2000,
        },
      }),
    });
    const result = await generateText({
      model: anthropic('claude-sonnet-5-5'),
      prompt: 'hi',
      maxRetries: 0,
    });
    expect(readUsage(result.totalUsage)).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2000,
    });
  });

  it('OpenAI: input_tokens includes cached tokens; they are split out', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network is disabled in tests')));
    const openai = createOpenAI({
      apiKey: 'sk-test',
      fetch: cannedFetch({
        id: 'resp_1',
        object: 'response',
        created_at: 1_764_000_000,
        status: 'completed',
        model: 'gpt-5.5-mini',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 3000,
          input_tokens_details: { cached_tokens: 2000 },
          output_tokens: 400,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 3400,
        },
      }),
    });
    const result = await generateText({
      model: openai('gpt-5.5-mini'),
      prompt: 'hi',
      maxRetries: 0,
    });
    expect(readUsage(result.totalUsage)).toEqual({
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 2000,
      cacheWriteTokens: 0,
    });
  });

  it('falls back to total − cache when the split is missing', () => {
    expect(
      readUsage({
        inputTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 500,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: undefined,
      }),
    ).toEqual({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0 });
  });
});

describe('verifyProviderKey (task 5.6)', () => {
  const key = 'sk-ant-api03-SECRET-0123';
  const fakeFetch = (status: number) => vi.fn(async () => ({ status }));

  it('200 → ok, sending the key only in the provider header', async () => {
    const fetchImpl = fakeFetch(200);
    expect(await verifyProviderKey('anthropic', key, fetchImpl)).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: expect.any(AbortSignal),
      }),
    );
    const openai = fakeFetch(200);
    await verifyProviderKey('openai', 'sk-test', openai);
    expect(openai).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET', headers: { authorization: 'Bearer sk-test' } }),
    );
  });

  it('401 / 403 → invalid', async () => {
    expect(await verifyProviderKey('anthropic', key, fakeFetch(401))).toBe('invalid');
    expect(await verifyProviderKey('openai', key, fakeFetch(403))).toBe('invalid');
  });

  it('network error or 5xx → unreachable, without the key in the error', async () => {
    const broken = vi.fn(async () => {
      throw new Error(`connect failed with ${key}`);
    });
    await expect(verifyProviderKey('anthropic', key, broken)).rejects.toThrow(
      'Provider could not be reached',
    );
    await expect(verifyProviderKey('anthropic', key, fakeFetch(503))).rejects.toThrow(
      'Provider could not be reached',
    );
    try {
      await verifyProviderKey('anthropic', key, broken);
    } catch (error) {
      expect(String(error)).not.toContain(key);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
