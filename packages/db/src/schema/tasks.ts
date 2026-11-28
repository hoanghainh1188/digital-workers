import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies, members } from './tenancy.ts';
import { workers } from './workers.ts';

/**
 * Tasks and web chat (change add-worker-runtime-webchat, design D1). `tasks` holds numbers
 * only (kept 1 year); message content lives in `task_messages` (deleted after 90 days,
 * 0.2 #019). Every table has company_id, RLS ENABLE + FORCE and composite foreign keys.
 */

export const conversationStatus = pgEnum('chat_conversation_status', ['open', 'closed']);
export const taskSource = pgEnum('task_source', ['web', 'telegram', 'zalo', 'schedule']);
export const taskStatus = pgEnum('task_status', [
  'collecting',
  'queued',
  'running',
  'succeeded',
  'failed',
  'stopped',
  'cancelled',
]);
export const taskMessageRole = pgEnum('task_message_role', ['user', 'worker', 'notice']);

/** Why a Task ended as stopped / failed / cancelled (design D5, D6, D9). */
export const STOP_REASONS = [
  'max_steps',
  'max_seconds',
  'max_charge',
  'credit_exhausted',
  'budget_exhausted',
  'runner_lost',
  'error',
  'worker_suspended',
  'worker_offboarded',
  'worker_unavailable',
  'no_access',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** One open conversation per (worker, member); "Cuộc trò chuyện mới" closes it (0.2 #126). */
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    memberId: uuid('member_id').notNull(),
    status: conversationStatus('status').notNull().default('open'),
    createdAt,
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    unique('chat_conversations_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'chat_conversations_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'chat_conversations_company_member_fk',
      columns: [table.companyId, table.memberId],
      foreignColumns: [members.companyId, members.id],
    }),
    uniqueIndex('chat_conversations_one_open_uq')
      .on(table.companyId, table.workerId, table.memberId)
      .where(sql`${table.status} = 'open'`),
    check(
      'chat_conversations_closed_at_matches',
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`,
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    /** NULL for scheduled Tasks (change 8). */
    conversationId: uuid('conversation_id'),
    requestedByMemberId: uuid('requested_by_member_id'),
    source: taskSource('source').notNull(),
    status: taskStatus('status').notNull().default('collecting'),
    stopReason: text('stop_reason'),
    /** Model calls so far (one step = one call, design D6). */
    steps: integer('steps').notNull().default(0),
    /** Running total of the Task's CostEntries in đồng; cost_entries stays the source of truth. */
    chargeVnd: bigint('charge_vnd', { mode: 'number' }).notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique('tasks_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'tasks_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'tasks_company_conversation_fk',
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
    }),
    foreignKey({
      name: 'tasks_company_requested_by_fk',
      columns: [table.companyId, table.requestedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    index('tasks_company_conversation_idx').on(
      table.companyId,
      table.conversationId,
      table.createdAt,
    ),
    index('tasks_company_worker_created_idx').on(table.companyId, table.workerId, table.createdAt),
    // The reaper looks only at unfinished Tasks (design D9).
    index('tasks_unfinished_idx')
      .on(table.status, table.heartbeatAt)
      .where(sql`${table.status} IN ('collecting', 'queued', 'running')`),
    check(
      'tasks_stop_reason_known',
      sql`${table.stopReason} IS NULL OR ${table.stopReason} IN (${sql.raw(
        STOP_REASONS.map((reason) => `'${reason}'`).join(', '),
      )})`,
    ),
    check(
      'tasks_stop_reason_matches',
      sql`(${table.status} IN ('stopped', 'failed', 'cancelled')) = (${table.stopReason} IS NOT NULL)`,
    ),
    check(
      'tasks_finished_at_matches',
      sql`(${table.status} IN ('succeeded', 'stopped', 'failed', 'cancelled')) = (${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      'tasks_counters_non_negative',
      sql`${table.steps} >= 0 AND ${table.chargeVnd} >= 0 AND ${table.messageCount} >= 0`,
    ),
  ],
);

/**
 * Message content (design D1). `task_id` is NULL for a message the worker did not take as
 * work (fixed reply, 0.2 #134). `seq` orders a conversation: every insert into one
 * conversation holds its advisory lock, so seq order = commit order.
 */
export const taskMessages = pgTable(
  'task_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    conversationId: uuid('conversation_id').notNull(),
    taskId: uuid('task_id'),
    role: taskMessageRole('role').notNull(),
    /** Set by the web for messages it sends, so a resend is recognised (0.2 #135). */
    clientMessageId: uuid('client_message_id'),
    content: text('content').notNull(),
    // Taken when the row is written (after the conversation lock), not at transaction
    // start, so created_at follows seq.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('task_messages_company_id_id_unique').on(table.companyId, table.id),
    unique('task_messages_client_message_unique').on(
      table.companyId,
      table.conversationId,
      table.clientMessageId,
    ),
    foreignKey({
      name: 'task_messages_company_conversation_fk',
      columns: [table.companyId, table.conversationId],
      foreignColumns: [chatConversations.companyId, chatConversations.id],
    }),
    foreignKey({
      name: 'task_messages_company_task_fk',
      columns: [table.companyId, table.taskId],
      foreignColumns: [tasks.companyId, tasks.id],
    }),
    index('task_messages_conversation_seq_idx').on(
      table.companyId,
      table.conversationId,
      table.seq,
    ),
    index('task_messages_company_task_idx').on(table.companyId, table.taskId),
    check('task_messages_content_length', sql`char_length(${table.content}) BETWEEN 1 AND 8000`),
    check(
      'task_messages_client_id_only_user',
      sql`${table.clientMessageId} IS NULL OR ${table.role} = 'user'`,
    ),
  ],
);

/** "Hết ngân sách" email sent for (worker, month in Vietnam time): at most once (0.2 #129). */
export const workerBudgetAlerts = pgTable(
  'worker_budget_alerts',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    month: text('month').notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({
      name: 'worker_budget_alerts_pk',
      columns: [table.companyId, table.workerId, table.month],
    }),
    foreignKey({
      name: 'worker_budget_alerts_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    check('worker_budget_alerts_month_format', sql`${table.month} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);
