import { randomUUID } from 'node:crypto';
import { createWebChannel } from '@dw/channels';
import { DEFAULT_TASK_LIMITS } from '@dw/core';
import { addModelPrice } from '@dw/db/testing/fixtures';
import { createGateway } from '@dw/llm';
import { createFakeModels } from '@dw/llm/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Test-only bridge to the runner: the same handlers apps/runner/src/main.ts wires to pg-boss.
import { createTaskHandlers } from '../../runner/src/tasks.ts';
import { startChatListener } from '../src/chat/listener.ts';
import { type Harness, makeApp, startHarness, WEB_ORIGIN } from './support/harness.ts';
import { call, seedOrg } from './support/org.ts';
import { giveCredit } from './support/platform.ts';
import { workerIn } from './support/workers.ts';

describe('web chat end to end without the web (task 7.5)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('message via API → runner (fake model) → "đang làm…" then the answer on the socket', async () => {
    const t = makeApp(harness);
    const org = await seedOrg(t, harness, 'Gốm An Phú');
    await giveCredit(harness, org.companyId, 100_000);
    await addModelPrice(harness.database);
    const workerId = await workerIn(t, org, 'active');

    const fake = createFakeModels({
      text: 'Dạ, báo giá 100 bát là 1.200.000đ.',
      inputTokens: 200,
      outputTokens: 60,
    });
    const silent = { info: () => {}, warn: () => {}, error: () => {} };
    const handlers = createTaskHandlers({
      database: harness.database,
      gateway: createGateway({
        database: harness.database,
        keys: { get: async () => 'k' },
        models: fake,
        logger: silent,
        maxRetries: 0,
      }),
      channel: createWebChannel(harness.database),
      queue: t.queue,
      model: { provider: 'anthropic', id: 'claude-sonnet-5-5' },
      limits: DEFAULT_TASK_LIMITS,
      window: { gapMs: 0, maxMs: 0, maxMessages: 20 },
      logger: silent,
    });
    const listener = startChatListener({
      connectionString: harness.pg.appUrl,
      onEvent: (event) => t.platform.chat.hub.dispatch(event),
      logger: { info: () => {}, warn: () => {} },
    });
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      for (let i = 0; i < 50 && !listener.healthy(); i += 1) await sleep(50);
      const conversation = (
        await call(
          t.app,
          'POST',
          `/api/chat/workers/${workerId}/conversations`,
          org.manager.cookie,
          {},
        )
      ).json();
      const socket = new WebSocket(`${address.replace('http', 'ws')}/api/chat/ws`, {
        headers: { cookie: org.manager.cookie, origin: WEB_ORIGIN },
      } as unknown as string[]);
      const frames: Array<{ type: string; message?: { role: string; content: string } }> = [];
      socket.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))));
      await new Promise((resolve) => socket.addEventListener('open', resolve));
      socket.send(JSON.stringify({ type: 'subscribe', conversationId: conversation.id }));
      await until(() => frames.some((f) => f.type === 'subscribed'));

      const sent = await call(
        t.app,
        'POST',
        `/api/chat/conversations/${conversation.id}/messages`,
        org.manager.cookie,
        {
          text: 'Báo giá 100 bát cơm',
          clientMessageId: randomUUID(),
        },
      );
      expect(sent.statusCode).toBe(201);
      // What pg-boss would deliver: task.start, then task.run.
      for (let round = 0; round < 10; round += 1) {
        const start = t.queue.starts.shift();
        if (start) await handlers.start(start.job);
        const run = t.queue.runs.shift();
        if (run) await handlers.run(run);
        if (!start && !run) break;
      }
      await until(() => frames.some((f) => f.type === 'message' && f.message?.role === 'worker'));
      const kinds = frames
        .filter((f) => f.type !== 'subscribed')
        .map((f) => (f.type === 'message' ? `message:${f.message?.role}` : f.type));
      expect(kinds).toEqual(['message:user', 'typing', 'message:worker']);
      expect(frames.at(-1)?.message?.content).toBe('Dạ, báo giá 100 bát là 1.200.000đ.');
      socket.close();
    } finally {
      await listener.close();
      await t.app.close();
    }
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(20);
  }
}
