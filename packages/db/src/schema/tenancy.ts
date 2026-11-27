import {
  boolean,
  index,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';

/**
 * Business tables (design D1). Every one has RLS ENABLE + FORCE keyed on
 * `app.company_id`; query them only inside `withCompany`.
 */

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'manager', 'member']);
export const memberStatus = pgEnum('member_status', ['active', 'locked']);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // UNIQUE across the whole system: one email belongs to exactly one company (0.2 #035).
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    role: memberRole('role').notNull(),
    status: memberStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('members_company_id_idx').on(table.companyId)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    actorMemberId: uuid('actor_member_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    // Names of changed fields only, never values (spec audit-log).
    fields: text('fields').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_company_created_idx').on(table.companyId, table.createdAt)],
);

/** members JOIN auth.users, `security_invoker` so the members RLS policy still filters. */
export const memberProfiles = pgView('member_profiles', {
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: memberRole('role').notNull(),
  status: memberStatus('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull(),
}).existing();
