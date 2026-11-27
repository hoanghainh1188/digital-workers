import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ping } from './ping.ts';

const poolWith = (query: () => Promise<unknown>) => ({ query }) as unknown as pg.Pool;

describe('ping', () => {
  it('returns true when SELECT 1 succeeds', async () => {
    expect(
      await ping(
        poolWith(async () => ({ rows: [] })),
        2_000,
      ),
    ).toBe(true);
  });

  it('returns false and reports the error when the query fails', async () => {
    const onError = vi.fn();
    const ok = await ping(
      poolWith(async () => Promise.reject(new Error('refused'))),
      2_000,
      onError,
    );
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('gives up after the timeout when the database never answers', async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const pending = ping(
        poolWith(() => new Promise(() => {})),
        2_000,
        onError,
      );
      await vi.advanceTimersByTimeAsync(1_999);
      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe(false);
      expect(String(onError.mock.calls[0]?.[0])).toContain('timed out after 2000ms');
    } finally {
      vi.useRealTimers();
    }
  });
});
