import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies, departments, members } from './tenancy.ts';

/**
 * Digital workers (change add-worker-profile, design D1). Every table has company_id,
 * RLS ENABLE + FORCE and composite foreign keys, so no row can point at another company.
 */

export const workerStatus = pgEnum('worker_status', [
  'draft',
  'probation',
  'active',
  'suspended',
  'offboarded',
]);
export const promotionRequestStatus = pgEnum('worker_promotion_status', [
  'pending',
  'approved',
  'returned',
  'closed',
]);
export const workerStatusEventKind = pgEnum('worker_status_event_kind', [
  'created',
  'status_changed',
  'proposed',
  'proposal_returned',
  'probation_extended',
]);

export const workers = pgTable(
  'workers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    // workerNameKey(name) from @dw/core — computed only in code (design D1).
    nameKey: text('name_key').notNull(),
    avatarColor: smallint('avatar_color').notNull().default(0),
    jobDescription: text('job_description').notNull().default(''),
    voicePreset: text('voice_preset'),
    voiceCustom: text('voice_custom'),
    monthlyBudgetVnd: bigint('monthly_budget_vnd', { mode: 'number' }).notNull(),
    managerMemberId: uuid('manager_member_id'),
    status: workerStatus('status').notNull().default('draft'),
    templateId: text('template_id'),
    probationStartedOn: date('probation_started_on', { mode: 'string' }),
    probationEndsOn: date('probation_ends_on', { mode: 'string' }),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    offboardedAt: timestamp('offboarded_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(0),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workers_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'workers_company_department_fk',
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
    }),
    foreignKey({
      name: 'workers_company_manager_fk',
      columns: [table.companyId, table.managerMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'workers_company_created_by_fk',
      columns: [table.companyId, table.createdByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    // Names are unique among workers that have not left (0.2 #049).
    uniqueIndex('workers_company_name_live_uq')
      .on(table.companyId, table.nameKey)
      .where(sql`${table.status} <> 'offboarded'`),
    index('workers_company_department_idx').on(table.companyId, table.departmentId),
    check('workers_budget_range', sql`${table.monthlyBudgetVnd} BETWEEN 0 AND 100000000`),
    check('workers_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 60`),
    check('workers_job_description_length', sql`char_length(${table.jobDescription}) <= 4000`),
    check(
      'workers_offboarded_at_matches',
      sql`(${table.status} = 'offboarded') = (${table.offboardedAt} IS NOT NULL)`,
    ),
  ],
);

export const workerTesters = pgTable(
  'worker_testers',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    memberId: uuid('member_id').notNull(),
    addedByMemberId: uuid('added_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'worker_testers_pk', columns: [table.workerId, table.memberId] }),
    foreignKey({
      name: 'worker_testers_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'worker_testers_company_member_fk',
      columns: [table.companyId, table.memberId],
      foreignColumns: [members.companyId, members.id],
    }),
  ],
);

export const workerPromotionRequests = pgTable(
  'worker_promotion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    requestedByMemberId: uuid('requested_by_member_id').notNull(),
    note: text('note'),
    status: promotionRequestStatus('status').notNull().default('pending'),
    decidedByMemberId: uuid('decided_by_member_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    returnReason: text('return_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('worker_promotion_requests_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'worker_promotion_requests_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'worker_promotion_requests_company_requested_by_fk',
      columns: [table.companyId, table.requestedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'worker_promotion_requests_company_decided_by_fk',
      columns: [table.companyId, table.decidedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    // At most one pending proposal per worker.
    uniqueIndex('worker_promotion_requests_pending_uq')
      .on(table.workerId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** Status history — append-only: dw_app has SELECT, INSERT only (design D1). */
export const workerStatusEvents = pgTable(
  'worker_status_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    kind: workerStatusEventKind('kind').notNull(),
    fromStatus: workerStatus('from_status'),
    toStatus: workerStatus('to_status').notNull(),
    actorMemberId: uuid('actor_member_id').notNull(),
    reason: text('reason'),
    requestId: uuid('request_id'),
    days: smallint('days'),
    templateId: text('template_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'worker_status_events_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'worker_status_events_company_actor_fk',
      columns: [table.companyId, table.actorMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'worker_status_events_company_request_fk',
      columns: [table.companyId, table.requestId],
      foreignColumns: [workerPromotionRequests.companyId, workerPromotionRequests.id],
    }),
    index('worker_status_events_worker_idx').on(table.workerId, table.createdAt),
  ],
);
