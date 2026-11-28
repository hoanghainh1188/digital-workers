import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tasks } from './tasks.ts';
import { companies } from './tenancy.ts';

/**
 * Credit ledger, model prices and platform settings (change add-llm-gateway-and-credit,
 * design D3/D4). Money columns are integers: VNĐ for balances and transactions,
 * micro-VNĐ (10⁻⁶ đồng) for the exact cost of one model call.
 */

export const creditTransactionKind = pgEnum('credit_transaction_kind', [
  'usage',
  'trial',
  'adjustment',
]);
export const creditReason = pgEnum('credit_reason', [
  'bank_transfer',
  'trial',
  'system_fix',
  'other',
]);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ── Platform-level tables: no company_id, no RLS (design D4) ────────────────

/** Prices in micro-USD per 1 million tokens. Append-only: a change is a new row. */
export const modelPrices = pgTable(
  'model_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputUsdMicrosPerMtok: bigint('input_usd_micros_per_mtok', { mode: 'number' }).notNull(),
    outputUsdMicrosPerMtok: bigint('output_usd_micros_per_mtok', { mode: 'number' }).notNull(),
    cacheReadUsdMicrosPerMtok: bigint('cache_read_usd_micros_per_mtok', {
      mode: 'number',
    }).notNull(),
    /** NULL: the provider does not price cache writes separately (billed as input). */
    cacheWriteUsdMicrosPerMtok: bigint('cache_write_usd_micros_per_mtok', { mode: 'number' }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    createdAt,
  },
  (table) => [
    unique('model_prices_model_effective_unique').on(
      table.provider,
      table.model,
      table.effectiveFrom,
    ),
    check('model_prices_provider', sql`${table.provider} IN ('anthropic', 'openai')`),
    check('model_prices_model_length', sql`char_length(${table.model}) BETWEEN 1 AND 100`),
    check(
      'model_prices_non_negative',
      sql`${table.inputUsdMicrosPerMtok} >= 0 AND ${table.outputUsdMicrosPerMtok} >= 0 AND ${table.cacheReadUsdMicrosPerMtok} >= 0 AND (${table.cacheWriteUsdMicrosPerMtok} IS NULL OR ${table.cacheWriteUsdMicrosPerMtok} >= 0)`,
    ),
  ],
);

/** USD → VNĐ, one value for every company. The current one is the latest effective row. */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vndPerUsd: integer('vnd_per_usd').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    createdAt,
  },
  (table) => [
    check('fx_rates_positive', sql`${table.vndPerUsd} > 0`),
    index('fx_rates_effective_idx').on(table.effectiveFrom),
  ],
);

/** Default price multiplier in thousandths (1,30 → 1300). */
export const priceMultipliers = pgTable(
  'price_multipliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    permille: integer('permille').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by'),
    createdAt,
  },
  (table) => [
    check('price_multipliers_at_least_one', sql`${table.permille} >= 1000`),
    index('price_multipliers_effective_idx').on(table.effectiveFrom),
  ],
);

/** Platform API keys, sealed with @dw/crypto (AAD `provider_key:<provider>`). */
export const providerKeys = pgTable(
  'provider_keys',
  {
    provider: text('provider').primaryKey(),
    sealed: text('sealed').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  },
  (table) => [check('provider_keys_provider', sql`${table.provider} IN ('anthropic', 'openai')`)],
);

/** Platform-level audit log (spec platform-admin). Field names only, never values. */
export const platformAuditEvents = pgTable(
  'platform_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    companyId: uuid('company_id').references(() => companies.id),
    fields: text('fields').array(),
    createdAt,
  },
  (table) => [index('platform_audit_events_created_idx').on(table.createdAt)],
);

// ── Business tables: company_id + RLS ENABLE + FORCE ───────────────────────

/** One per company (spec credit-ledger). Changed only together with a credit_transactions row. */
export const creditAccounts = pgTable(
  'credit_accounts',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id),
    balanceVnd: bigint('balance_vnd', { mode: 'number' }).notNull().default(0),
    /** Fraction of a đồng still owed, carried to the next charge (design D3). */
    carryMicroVnd: bigint('carry_microvnd', { mode: 'number' }).notNull().default(0),
    /** Company-specific multiplier (‰); NULL = platform default. */
    multiplierPermille: integer('multiplier_permille'),
    /** Amount of the latest credit (trial, adjustment): base of the 20% threshold (#071). */
    lastCreditVnd: bigint('last_credit_vnd', { mode: 'number' }).notNull().default(0),
    lowNotified: boolean('low_notified').notNull().default(false),
    zeroNotified: boolean('zero_notified').notNull().default(false),
    trialGrantedAt: timestamp('trial_granted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('credit_accounts_carry_range', sql`${table.carryMicroVnd} BETWEEN 0 AND 999999`),
    check(
      'credit_accounts_multiplier',
      sql`${table.multiplierPermille} IS NULL OR ${table.multiplierPermille} >= 1000`,
    ),
  ],
);

/** One per billed model call. Append-only. task_id → tasks since change 5 (design D1). */
export const costEntries = pgTable(
  'cost_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    workerId: uuid('worker_id'),
    taskId: uuid('task_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    priceId: uuid('price_id')
      .notNull()
      .references(() => modelPrices.id),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    vndPerUsd: integer('vnd_per_usd').notNull(),
    multiplierPermille: integer('multiplier_permille').notNull(),
    realCostMicroVnd: bigint('real_cost_microvnd', { mode: 'bigint' }).notNull(),
    chargeMicroVnd: bigint('charge_microvnd', { mode: 'bigint' }).notNull(),
    createdAt,
  },
  (table) => [
    unique('cost_entries_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      name: 'cost_entries_company_task_fk',
      columns: [table.companyId, table.taskId],
      foreignColumns: [tasks.companyId, tasks.id],
    }),
    index('cost_entries_company_task_idx').on(table.companyId, table.taskId),
    index('cost_entries_company_created_idx').on(table.companyId, table.createdAt),
    index('cost_entries_company_worker_created_idx').on(
      table.companyId,
      table.workerId,
      table.createdAt,
    ),
    check(
      'cost_entries_tokens_non_negative',
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.cacheReadTokens} >= 0 AND ${table.cacheWriteTokens} >= 0`,
    ),
    check(
      'cost_entries_money_non_negative',
      sql`${table.realCostMicroVnd} >= 0 AND ${table.chargeMicroVnd} >= 0`,
    ),
  ],
);

/** Append-only ledger (spec credit-ledger). amount_vnd > 0 credits, < 0 debits. */
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: creditTransactionKind('kind').notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    balanceAfterVnd: bigint('balance_after_vnd', { mode: 'number' }).notNull(),
    costEntryId: uuid('cost_entry_id').unique(),
    reason: creditReason('reason'),
    note: text('note'),
    /** Platform admin (auth user id) for adjustments. */
    actorAdminId: uuid('actor_admin_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt,
  },
  (table) => [
    foreignKey({
      name: 'credit_transactions_cost_entry_fk',
      columns: [table.companyId, table.costEntryId],
      foreignColumns: [costEntries.companyId, costEntries.id],
    }),
    unique('credit_transactions_idempotency_unique').on(table.companyId, table.idempotencyKey),
    // A company gets the automatic trial at most once, even under concurrency (design D8).
    uniqueIndex('credit_transactions_one_trial_uq')
      .on(table.companyId)
      .where(sql`${table.kind} = 'trial'`),
    index('credit_transactions_company_created_idx').on(table.companyId, table.createdAt),
    check(
      'credit_transactions_usage_shape',
      sql`(${table.kind} = 'usage') = (${table.costEntryId} IS NOT NULL) AND (${table.kind} <> 'usage' OR (${table.amountVnd} <= 0 AND ${table.reason} IS NULL))`,
    ),
    check(
      'credit_transactions_adjustment_shape',
      sql`${table.kind} <> 'adjustment' OR (${table.reason} IS NOT NULL AND ${table.note} IS NOT NULL AND ${table.amountVnd} <> 0)`,
    ),
    check(
      'credit_transactions_trial_positive',
      sql`${table.kind} <> 'trial' OR ${table.amountVnd} > 0`,
    ),
    check(
      'credit_transactions_note_length',
      sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND 200`,
    ),
  ],
);
