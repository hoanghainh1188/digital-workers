import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
 * Skill library (change add-skill-library, design D1). Content lives in PostgreSQL:
 * versions are immutable once submitted, files point at content-addressed blobs that
 * are shared between versions of the same company only. Every table has company_id,
 * RLS ENABLE + FORCE and composite foreign keys.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const skillRisk = pgEnum('skill_risk', ['low', 'medium', 'high']);
export const skillVersionStatus = pgEnum('skill_version_status', [
  'draft',
  'pending',
  'approved',
  'rejected',
  'superseded',
]);
export const workerSkillStatus = pgEnum('worker_skill_status', ['active', 'pending', 'suspended']);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    title: text('title').notNull(),
    // FK (company_id, id, current_version_id) → skill_versions (company_id, skill_id, id)
    // is added by hand in the migration: the two tables point at each other.
    currentVersionId: uuid('current_version_id'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByMemberId: uuid('archived_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('skills_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'skills_company_created_by_fk',
      columns: [table.companyId, table.createdByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'skills_company_archived_by_fk',
      columns: [table.companyId, table.archivedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    // `name` is unique among skills that are not archived (0.2 #093).
    uniqueIndex('skills_company_name_live_uq')
      .on(table.companyId, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    check(
      'skills_name_format',
      sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.name}) <= 64`,
    ),
    check(
      'skills_archived_by_matches',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByMemberId} IS NULL)`,
    ),
  ],
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    skillId: uuid('skill_id').notNull(),
    number: integer('number').notNull(),
    status: skillVersionStatus('status').notNull().default('draft'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    hasScripts: boolean('has_scripts').notNull().default(false),
    suggestedRisk: skillRisk('suggested_risk').notNull(),
    proposedRisk: skillRisk('proposed_risk'),
    risk: skillRisk('risk'),
    changeNote: text('change_note'),
    revision: integer('revision').notNull().default(0),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    submittedByMemberId: uuid('submitted_by_member_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedByMemberId: uuid('decided_by_member_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    everApproved: boolean('ever_approved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('skill_versions_company_id_id_unique').on(table.companyId, table.id),
    unique('skill_versions_company_skill_id_unique').on(table.companyId, table.skillId, table.id),
    unique('skill_versions_skill_number_unique').on(table.companyId, table.skillId, table.number),
    foreignKey({
      name: 'skill_versions_company_skill_fk',
      columns: [table.companyId, table.skillId],
      foreignColumns: [skills.companyId, skills.id],
    }),
    foreignKey({
      name: 'skill_versions_company_created_by_fk',
      columns: [table.companyId, table.createdByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'skill_versions_company_submitted_by_fk',
      columns: [table.companyId, table.submittedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'skill_versions_company_decided_by_fk',
      columns: [table.companyId, table.decidedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    // At most one open draft and one pending version per skill (design D2).
    uniqueIndex('skill_versions_one_draft_uq')
      .on(table.companyId, table.skillId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('skill_versions_one_pending_uq')
      .on(table.companyId, table.skillId)
      .where(sql`${table.status} = 'pending'`),
    check('skill_versions_number_positive', sql`${table.number} >= 1`),
    check(
      'skill_versions_description_length',
      sql`char_length(${table.description}) BETWEEN 1 AND 1024`,
    ),
    // Script skills are always high risk (#056, FR-03-06).
    check(
      'skill_versions_scripts_high',
      sql`NOT ${table.hasScripts} OR (${table.suggestedRisk} = 'high' AND coalesce(${table.proposedRisk}, 'high') = 'high' AND coalesce(${table.risk}, 'high') = 'high')`,
    ),
    check(
      'skill_versions_approved_has_risk',
      sql`${table.status} <> 'approved' OR ${table.risk} IS NOT NULL`,
    ),
    check(
      'skill_versions_rejected_has_reason',
      sql`${table.status} <> 'rejected' OR ${table.rejectReason} IS NOT NULL`,
    ),
  ],
);

/** Content-addressed file bodies, per company (never shared across companies). */
export const skillBlobs = pgTable(
  'skill_blobs',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    content: bytea('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'skill_blobs_pk', columns: [table.companyId, table.sha256] }),
    check('skill_blobs_sha256_format', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('skill_blobs_size_matches', sql`${table.size} = octet_length(${table.content})`),
  ],
);

/** Files of a version; SKILL.md is one row too. Rows change only while the version is a draft. */
export const skillVersionFiles = pgTable(
  'skill_version_files',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    versionId: uuid('version_id').notNull(),
    path: text('path').notNull(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    mediaType: text('media_type').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'skill_version_files_pk',
      columns: [table.companyId, table.versionId, table.path],
    }),
    foreignKey({
      name: 'skill_version_files_company_version_fk',
      columns: [table.companyId, table.versionId],
      foreignColumns: [skillVersions.companyId, skillVersions.id],
    }),
    foreignKey({
      name: 'skill_version_files_company_blob_fk',
      columns: [table.companyId, table.sha256],
      foreignColumns: [skillBlobs.companyId, skillBlobs.sha256],
    }),
    check('skill_version_files_path_length', sql`char_length(${table.path}) BETWEEN 1 AND 200`),
  ],
);

export const workerSkills = pgTable(
  'worker_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    status: workerSkillStatus('status').notNull(),
    assignedByMemberId: uuid('assigned_by_member_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedByMemberId: uuid('decided_by_member_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('worker_skills_worker_skill_unique').on(table.companyId, table.workerId, table.skillId),
    foreignKey({
      name: 'worker_skills_company_worker_fk',
      columns: [table.companyId, table.workerId],
      foreignColumns: [workers.companyId, workers.id],
    }),
    foreignKey({
      name: 'worker_skills_company_skill_fk',
      columns: [table.companyId, table.skillId],
      foreignColumns: [skills.companyId, skills.id],
    }),
    foreignKey({
      name: 'worker_skills_company_assigned_by_fk',
      columns: [table.companyId, table.assignedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    foreignKey({
      name: 'worker_skills_company_decided_by_fk',
      columns: [table.companyId, table.decidedByMemberId],
      foreignColumns: [members.companyId, members.id],
    }),
    index('worker_skills_skill_idx').on(table.companyId, table.skillId),
  ],
);
