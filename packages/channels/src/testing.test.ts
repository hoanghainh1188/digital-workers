import { describe, expect, it } from 'vitest';
import { createFakeChannel } from './testing.ts';

describe('fake channel', () => {
  it('records typing and sends in order', async () => {
    const channel = createFakeChannel();
    const target = { kind: 'web', companyId: 'c', workerId: 'w', chatExternalId: 'x' } as const;
    await channel.sendTyping(target);
    await channel.send(target, { text: 'Xong', role: 'worker', taskId: 't' });
    expect(channel.sent.map((entry) => entry.type)).toEqual(['typing', 'send']);
  });
});
