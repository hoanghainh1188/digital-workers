import { freePort } from '@dw/core/testing';
import { describe, expect, it } from 'vitest';
import { startChatListener } from '../src/chat/listener.ts';

describe('chat listener health (task 7.3)', () => {
  it('stays ready for 30 s without LISTEN, then reports unavailable', async () => {
    let now = 1_000_000;
    const port = await freePort();
    const warnings: string[] = [];
    const listener = startChatListener({
      // Nothing listens on this port: every connection attempt fails.
      connectionString: `postgres://dw_app:pw@127.0.0.1:${port}/dw`,
      onEvent: () => {},
      logger: { info: () => {}, warn: (_details, message) => warnings.push(message) },
      now: () => now,
    });
    try {
      expect(listener.healthy()).toBe(true);
      now += 30_000;
      expect(listener.healthy()).toBe(true);
      now += 1_000;
      expect(listener.healthy()).toBe(false);
    } finally {
      await listener.close();
    }
  });
});
