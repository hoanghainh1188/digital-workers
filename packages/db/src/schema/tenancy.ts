import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';

/**
 * Business tables (design D1). Every one has RLS ENABLE + FORCE keyed on
 * `app.company_id`; query them only inside `withCompany`.
 */

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'manager', 'member']);
export const memberStatus = pgEnum('member_status', ['active', 'locked']);
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'cancelled']);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  contactPhone: text('contact_phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Departments (design D1). The head is derived: the member with role 'manager' and
 * this department_id (0.2 #061); a partial unique index on members keeps it to one.
 */
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Target of the composite foreign keys: a row can only point at its own company's department.
    unique('departments_company_id_id_unique').on(table.companyId, table.id),
    uniqueIndex('departments_company_name_active_uq')
      .on(table.companyId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);

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
    departmentId: uuid('department_id'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('members_company_id_idx').on(table.companyId),
    foreignKey({
      name: 'members_company_department_fk',
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
    }),
    // Manager and Member must have a department (0.2 #036).
    check(
      'members_department_required',
      sql`${table.role} IN ('owner', 'admin') OR ${table.departmentId} IS NOT NULL`,
    ),
    check(
      'members_locked_at_matches',
      sql`(${table.status} = 'locked') = (${table.lockedAt} IS NOT NULL)`,
    ),
    // At most one Manager per department (0.2 #036).
    uniqueIndex('members_department_manager_uq')
      .on(table.departmentId)
      .where(sql`${table.role} = 'manager'`),
  ],
);

/** Email invitations (design D1, D4). Only the SHA-256 of the token is stored. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    departmentId: uuid('department_id'),
    invitedByMemberId: uuid('invited_by_member_id')
      .notNull()
      .references(() => members.id),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    acceptedMemberId: uuid('accepted_member_id').references(() => members.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'invitations_company_department_fk',
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
    }),
    check(
      'invitations_department_required',
      sql`${table.role} IN ('owner', 'admin') OR ${table.departmentId} IS NOT NULL`,
    ),
    check('invitations_email_lowercase', sql`${table.email} = lower(${table.email})`),
    uniqueIndex('invitations_company_email_pending_uq')
      .on(table.companyId, table.email)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('invitations_department_manager_pending_uq')
      .on(table.departmentId)
      .where(sql`${table.status} = 'pending' AND ${table.role} = 'manager'`),
  ],
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
  departmentId: uuid('department_id'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull(),
}).existing();
