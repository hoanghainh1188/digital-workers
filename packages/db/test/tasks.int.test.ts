import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COALESCE_WINDOW } from '@dw/core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHAT_EVENTS_CHANNEL,
  chatConversations,
  claimTask,
  closeWindowIfDue,
  costEntries,
  createDatabase,
  type Database,
  finishTask,
  insertMessage,
  joinOrCreateTask,
  listMessages,
  lockConversation,
  notifyChat,
  openConversation,
  taskMessages,
  tasks,
  tasksNeedingAttention,
  withCompany,
  workerBudgetAlerts,
} from '../src/index.ts';
import { migrationsFolder, runMigrations } from '../src/migrate.ts';
import { startQueue } from '../src/queue.ts';
import { addModelPrice, addWorker, seedTenant, type TenantFixture } from './fixtures.ts';
import { startTestPostgres, type TestPostgres } from './pg.ts';

async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const { message, cause } = error as { message: string; cause?: { message?: string } };
    return `${message} ${cause?.message ?? ''}`;
  }
  throw new Error('expected the database to reject the statement');
}

type Seeded = TenantFixture & { workerId: string; conversationId: string; taskId: string };

describe('task and chat tables (dw_app, design D1, D2)', () => {
  let pgTest: TestPostgres;
  let app: Database;
  let owner: Database;
  let a: Seeded;
  let b: Seeded;

  async function seed(label: string): Promise<Seeded> {
    const tenant = await seedTenant(app, label);
    const workerId = await addWorker(app, tenant);
    return withCompany(app, tenant.companyId, async (tx) => {
      const conversation = await openConversation(
        tx,
        tenant.companyId,
        workerId,
        tenant.ownerMemberId,
      );
      await lockConversation(tx, conversation.id);
      const { task } = await joinOrCreateTask(tx, {
        companyId: tenant.companyId,
        workerId,
        conversationId: conversation.id,
        memberId: tenant.ownerMemberId,
        source: 'web',
        window: DEFAULT_COALESCE_WINDOW,
      });
      await insertMessage(tx, {
        companyId: tenant.companyId,
        conversationId: conversation.id,
        taskId: task.id,
        role: 'user',
        content: `Báo giá ${label}`,
        clientMessageId: randomUUID(),
      });
      return { ...tenant, workerId, conversationId: conversation.id, taskId: task.id };
    });
  }

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl, { max: 6 });
    owner = createDatabase(pgTest.ownerUrl, { max: 2 });
    a = await seed('a');
    b = await seed('b');
  });

  afterAll(async () => {
    await app?.close();
    await owner?.close();
    await pgTest?.stop();
  });

  describe('tenant isolation of the four new tables (task 2.4)', () => {
    const tables = [
      ['chat_conversations', chatConversations],
      ['tasks', tasks],
      ['task_messages', taskMessages],
      ['worker_budget_alerts', workerBudgetAlerts],
    ] as const;

    it('company A reads only its own rows', async () => {
      await withCompany(app, a.companyId, (tx) =>
        tx.insert(workerBudgetAlerts).values({
          companyId: a.companyId,
          workerId: a.workerId,
          month: '2026-11',
        }),
      );
      for (const [, table] of tables) {
        const rows = await withCompany(app, a.companyId, (tx) => tx.select().from(table));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.companyId === a.companyId)).toBe(true);
      }
    });

    it('without a company nothing is visible', async () => {
      for (const [name] of tables) {
        const { rows } = await app.pool.query(`select count(*)::int as n from ${name}`);
        expect(rows[0].n).toBe(0);
      }
    });

    it("company A cannot insert rows carrying company B's id", async () => {
      const message = await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx.insert(tasks).values({
            companyId: b.companyId,
            workerId: b.workerId,
            conversationId: b.conversationId,
            source: 'web',
          }),
        ),
      );
      expect(message).toMatch(/row-level security/);
      const crossMessage = await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx.insert(taskMessages).values({
            companyId: a.companyId,
            conversationId: b.conversationId,
            role: 'user',
            content: 'x',
          }),
        ),
      );
      expect(crossMessage).toMatch(/foreign key|violates/);
    });

    it("company A can neither update nor see B's task", async () => {
      const updated = await withCompany(app, a.companyId, (tx) =>
        tx
          .update(tasks)
          .set({ steps: 99 })
          .where(sql`${tasks.id} = ${b.taskId}`)
          .returning({ id: tasks.id }),
      );
      expect(updated).toEqual([]);
      const claimed = await withCompany(app, a.companyId, (tx) => claimTask(tx, b.taskId));
      expect(claimed).toBeNull();
    });
  });

  describe('constraints (task 2.1)', () => {
    it('a message without a Task is allowed and keeps its conversation (0.2 #134)', async () => {
      const { message } = await withCompany(app, a.companyId, (tx) =>
        insertMessage(tx, {
          companyId: a.companyId,
          conversationId: a.conversationId,
          taskId: null,
          role: 'notice',
          content: 'Minh đang tạm nghỉ, chưa nhận việc mới.',
        }),
      );
      expect(message.taskId).toBeNull();
      expect(
        await dbError(
          withCompany(app, a.companyId, (tx) =>
            tx
              .insert(taskMessages)
              .values({ companyId: a.companyId, role: 'user', content: 'x' } as never),
          ),
        ),
      ).toMatch(/null value|not-null/);
    });

    it('the same clientMessageId is stored once per conversation (0.2 #135)', async () => {
      const clientMessageId = randomUUID();
      const send = () =>
        withCompany(app, a.companyId, async (tx) => {
          await lockConversation(tx, a.conversationId);
          return insertMessage(tx, {
            companyId: a.companyId,
            conversationId: a.conversationId,
            taskId: null,
            role: 'user',
            content: 'Gửi lại',
            clientMessageId,
          });
        });
      const first = await send();
      const second = await send();
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.message.id).toBe(first.message.id);
    });

    it('one open conversation per (worker, member)', async () => {
      const message = await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx.insert(chatConversations).values({
            companyId: a.companyId,
            workerId: a.workerId,
            memberId: a.ownerMemberId,
          }),
        ),
      );
      expect(message).toMatch(/chat_conversations_one_open_uq/);
    });

    it('a stopped Task must say why', async () => {
      const message = await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx
            .update(tasks)
            .set({ status: 'stopped', finishedAt: new Date() })
            .where(sql`${tasks.id} = ${a.taskId}`),
        ),
      );
      expect(message).toMatch(/tasks_stop_reason_matches/);
    });

    it('dw_app cannot delete tasks, nor change or delete budget alerts', async () => {
      const { rows } = await owner.pool.query(
        `select has_table_privilege('dw_app', 'tasks', 'DELETE') as task_delete,
                has_table_privilege('dw_app', 'worker_budget_alerts', 'UPDATE') as alert_update,
                has_table_privilege('dw_app', 'task_messages', 'UPDATE') as message_update`,
      );
      expect(rows[0]).toEqual({ task_delete: false, alert_update: false, message_update: false });
    });
  });

  describe('cost_entries.task_id (task 2.2)', () => {
    it("refuses a CostEntry pointing at another company's Task", async () => {
      const priceId = await addModelPrice(app);
      const message = await dbError(
        withCompany(app, a.companyId, (tx) =>
          tx.insert(costEntries).values({
            companyId: a.companyId,
            workerId: a.workerId,
            taskId: b.taskId,
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            priceId,
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            vndPerUsd: 25_400,
            multiplierPermille: 1300,
            realCostMicroVnd: 1n,
            chargeMicroVnd: 1n,
          }),
        ),
      );
      expect(message).toMatch(/cost_entries_company_task_fk/);
    });
  });

  describe('queue and notifications', () => {
    it('pg-boss installs into schema pgboss as dw_app, without CREATE on the database (task 2.3)', async () => {
      const { rows } = await owner.pool.query(
        "select has_database_privilege('dw_app', current_database(), 'CREATE') as can_create",
      );
      expect(rows[0].can_create).toBe(false);
      const handle = await startQueue({
        connectionString: pgTest.appUrl,
        onError: (error) => {
          throw error;
        },
      });
      try {
        await handle.queue.sendRun({ companyId: a.companyId, taskId: a.taskId });
        const jobs = await handle.boss.fetch<{ companyId: string; taskId: string }>('task.run');
        expect(jobs?.[0]?.data).toEqual({ companyId: a.companyId, taskId: a.taskId });
      } finally {
        await handle.stop(1_000);
      }
    });

    it('NOTIFY reaches a listener only after commit, with ids only (task 4.4)', async () => {
      const listener = new pg.Client({ connectionString: pgTest.appUrl });
      await listener.connect();
      const received: string[] = [];
      listener.on('notification', (msg) => received.push(msg.payload ?? ''));
      await listener.query(`LISTEN ${CHAT_EVENTS_CHANNEL}`);
      try {
        await withCompany(app, a.companyId, async (tx) => {
          await notifyChat(tx, {
            companyId: a.companyId,
            conversationId: a.conversationId,
            event: 'typing',
          });
          await new Promise((resolve) => setTimeout(resolve, 150));
          expect(received).toEqual([]);
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(received.map((payload) => JSON.parse(payload))).toEqual([
          { companyId: a.companyId, conversationId: a.conversationId, event: 'typing' },
        ]);
      } finally {
        await listener.end();
      }
    });
  });

  describe('Task lifecycle', () => {
    it('runs once even when claimed twice, and in order within a conversation', async () => {
      const t = await seed('order');
      const second = await withCompany(app, t.companyId, async (tx) => {
        await tx
          .update(tasks)
          .set({ lastMessageAt: sql`now() - interval '1 minute'` })
          .where(sql`${tasks.id} = ${t.taskId}`);
        await lockConversation(tx, t.conversationId);
        expect(await closeWindowIfDue(tx, t.taskId, DEFAULT_COALESCE_WINDOW)).toEqual({
          kind: 'queued',
          runnable: true,
        });
        const { task } = await joinOrCreateTask(tx, {
          companyId: t.companyId,
          workerId: t.workerId,
          conversationId: t.conversationId,
          memberId: t.ownerMemberId,
          source: 'web',
          window: DEFAULT_COALESCE_WINDOW,
        });
        await tx
          .update(tasks)
          .set({ status: 'queued', queuedAt: sql`now() + interval '1 second'` })
          .where(sql`${tasks.id} = ${task.id}`);
        return task.id;
      });
      expect(await withCompany(app, t.companyId, (tx) => claimTask(tx, second))).toBeNull();
      const [x, y] = await Promise.all([
        withCompany(app, t.companyId, (tx) => claimTask(tx, t.taskId)),
        withCompany(app, t.companyId, (tx) => claimTask(tx, t.taskId)),
      ]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      expect(await withCompany(app, t.companyId, (tx) => claimTask(tx, second))).toBeNull();
      await withCompany(app, t.companyId, (tx) => finishTask(tx, t.taskId, 'succeeded', null));
      expect(await withCompany(app, t.companyId, (tx) => claimTask(tx, second))).not.toBeNull();
    });

    it('the reaper function sees lost and orphaned Tasks of every company, ids only', async () => {
      const t = await seed('reap');
      await withCompany(app, t.companyId, (tx) =>
        tx
          .update(tasks)
          .set({ lastMessageAt: sql`now() - interval '3 minutes'` })
          .where(sql`${tasks.id} = ${t.taskId}`),
      );
      const due = await tasksNeedingAttention(app, {
        lostAfterSeconds: 60,
        orphanAfterSeconds: 120,
      });
      expect(due).toContainEqual({
        companyId: t.companyId,
        taskId: t.taskId,
        conversationId: t.conversationId,
        kind: 'collecting',
      });
      expect(Object.keys(due[0] ?? {}).sort()).toEqual([
        'companyId',
        'conversationId',
        'kind',
        'taskId',
      ]);
    });

    it('lists messages after a given one, in order', async () => {
      const messages = await withCompany(app, a.companyId, (tx) =>
        listMessages(tx, a.conversationId, { limit: 100 }),
      );
      const after = await withCompany(app, a.companyId, (tx) =>
        listMessages(tx, a.conversationId, { afterId: messages[0]?.id ?? null, limit: 100 }),
      );
      expect(after.map((m) => m.id)).toEqual(messages.slice(1).map((m) => m.id));
    });
  });
});

describe('migration 0007 on a database with change-4 data (task 2.1)', () => {
  let pgTest: TestPostgres;
  let folder: string;

  beforeAll(async () => {
    pgTest = await startTestPostgres({ migrate: false });
    folder = await mkdtemp(join(tmpdir(), 'dw-migrations-'));
    await cp(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 7);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(pgTest.ownerUrl, folder);
    await writeFile(journalPath, JSON.stringify(full));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
    await pgTest?.stop();
  });

  it('keeps existing CostEntries (task_id NULL) and validates the new foreign key', async () => {
    const app = createDatabase(pgTest.appUrl, { max: 1 });
    try {
      const tenant = await seedTenant(app, 'legacy');
      const priceId = await addModelPrice(app);
      await withCompany(app, tenant.companyId, (tx) =>
        tx.insert(costEntries).values({
          companyId: tenant.companyId,
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          priceId,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          vndPerUsd: 25_400,
          multiplierPermille: 1300,
          realCostMicroVnd: 10n,
          chargeMicroVnd: 13n,
        }),
      );
      await runMigrations(pgTest.ownerUrl, folder);
      const rows = await withCompany(app, tenant.companyId, (tx) => tx.select().from(costEntries));
      expect(rows).toHaveLength(1);
      const { rows: constraints } = await app.pool.query(
        "select convalidated from pg_constraint where conname = 'cost_entries_company_task_fk'",
      );
      expect(constraints[0]?.convalidated).toBe(true);
    } finally {
      await app.close();
    }
  });
});
