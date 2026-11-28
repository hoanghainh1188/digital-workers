import { fileURLToPath } from 'node:url';
import { freePort, startNode } from '@dw/core/testing';
import { QUEUE_NAMES, startQueue, taskJobSchema } from '@dw/db/queue';
import { addWorker, seedTenant } from '@dw/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeRuntime, sleep, startDatabase, taskOf } from './support.ts';

const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('runner process (task 5.1, 0.2 #136)', { timeout: 60_000 }, () => {
  let db: Awaited<ReturnType<typeof startDatabase>>;

  beforeAll(async () => {
    db = await startDatabase();
  });

  afterAll(async () => {
    await db?.stop();
  });

  it('starts on the database as dw_app, is ready, and exits 0 on SIGTERM without secrets', async () => {
    const port = await freePort();
    const key = Buffer.alloc(32, 7).toString('base64');
    const proc = startNode(entry, {
      DATABASE_URL: db.pg.appUrl,
      ENCRYPTION_KEY: key,
      SMTP_URL: 'smtp://127.0.0.1:1',
      MAIL_FROM: 'noreply@dw.test',
      HEALTH_PORT: String(port),
      LOG_LEVEL: 'info',
      ANTHROPIC_API_KEY: 'sk-ant-LEAK-123',
    });
    try {
      await proc.waitFor('"msg":"started"', 30_000);
      const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ready' });
    } finally {
      proc.child.kill('SIGTERM');
    }
    const result = await proc.exited;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"msg":"stopped"');
    const all = result.stdout + result.stderr;
    expect(all).not.toContain('sk-ant-LEAK-123');
    expect(all).not.toContain(key);
    expect(all).not.toContain('app_test_pw');
  });

  it('a graceful stop lets the running Task finish and takes no new one', async () => {
    const tenant = await seedTenant(db.app, 'shutdown');
    const workerId = await addWorker(db.app, tenant);
    const rt = makeRuntime(db.app);
    rt.fake.reply = { text: 'Xong sau 1,5 giây', inputTokens: 1, outputTokens: 1, delayMs: 1_500 };
    const handle = await startQueue({
      connectionString: db.pg.appUrl,
      onError: () => {},
    });
    await handle.boss.work(
      QUEUE_NAMES.run,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs) await rt.handlers.run(taskJobSchema.parse(job.data));
      },
    );
    const first = await rt.say(tenant.companyId, workerId, tenant.ownerMemberId, 'Việc đang chạy');
    const second = await rt.say(
      tenant.companyId,
      workerId,
      tenant.ownerMemberId,
      'Việc khác',
      undefined,
    );
    for (const start of rt.queue.starts.splice(0)) await rt.handlers.start(start.job);
    const firstRun = rt.queue.runs.shift();
    if (!firstRun || first.result.kind !== 'stored') throw new Error('no job');
    await handle.queue.sendRun(firstRun);
    // Wait until the Task is running, then stop as on deploy (SIGTERM).
    for (let i = 0; i < 40; i += 1) {
      if ((await taskOf(db.app, tenant.companyId, firstRun.taskId)).status === 'running') break;
      await sleep(100);
    }
    const stopping = handle.stop(10_000);
    await sleep(100);
    const secondRun = rt.queue.runs.shift();
    if (secondRun) await handle.queue.sendRun(secondRun).catch(() => {});
    await stopping;
    expect(await taskOf(db.app, tenant.companyId, firstRun.taskId)).toMatchObject({
      status: 'succeeded',
    });
    if (
      second.result.kind === 'stored' &&
      second.result.taskId &&
      second.result.taskId !== firstRun.taskId
    ) {
      expect((await taskOf(db.app, tenant.companyId, second.result.taskId)).status).not.toBe(
        'running',
      );
    }
  });
});
