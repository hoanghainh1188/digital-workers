import { randomUUID } from 'node:crypto';
import {
  companies,
  createDatabase,
  type Database,
  fxRates,
  members,
  modelPrices,
  withCompany,
} from '@dw/db';
import { sql } from '@dw/db/drizzle';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import { type EffectivePrice, effectivePrice } from '../src/effective.ts';
import { ensureCreditAccount } from '../src/ledger.ts';

export type BillingHarness = {
  readonly pg: TestPostgres;
  readonly app: Database;
  readonly stop: () => Promise<void>;
};

export async function startBillingHarness(): Promise<BillingHarness> {
  const pg = await startTestPostgres();
  const app = createDatabase(pg.appUrl, { max: 25 });
  return {
    pg,
    app,
    stop: async () => {
      await app.close();
      await pg.stop();
    },
  };
}

/** A company with one Owner and a 0đ credit account. */
export async function seedCompany(
  app: Database,
  label: string,
  options: { verified?: boolean } = {},
): Promise<{ companyId: string; userId: string }> {
  const userId = randomUUID();
  await app.pool.query(
    'insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, $4)',
    [userId, `Owner ${label}`, `${label}-${userId}@example.com`, options.verified ?? false],
  );
  const companyId = randomUUID();
  await withCompany(app, companyId, async (tx) => {
    await tx.insert(companies).values({ id: companyId, name: `Company ${label}` });
    await tx.insert(members).values({ companyId, userId, role: 'owner' });
    await ensureCreditAccount(tx, companyId);
  });
  return { companyId, userId };
}

export const SONNET: {
  provider: 'anthropic' | 'openai';
  model: string;
  inputUsdMicrosPerMtok: number;
  outputUsdMicrosPerMtok: number;
  cacheReadUsdMicrosPerMtok: number;
  cacheWriteUsdMicrosPerMtok: number | null;
} = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  inputUsdMicrosPerMtok: 3_000_000,
  outputUsdMicrosPerMtok: 15_000_000,
  cacheReadUsdMicrosPerMtok: 300_000,
  cacheWriteUsdMicrosPerMtok: 3_750_000,
};

/** Inserts a price (effective long ago unless given) and returns it as the gateway sees it. */
export async function addPrice(
  app: Database,
  overrides: Partial<typeof SONNET> & { effectiveFrom?: Date } = {},
): Promise<EffectivePrice> {
  const values = { ...SONNET, effectiveFrom: new Date('2026-01-01T00:00:00Z'), ...overrides };
  await app.db.insert(modelPrices).values(values);
  const price = await effectivePrice(app.db, values.provider, values.model, values.effectiveFrom);
  if (!price) throw new Error('price not found after insert');
  return price;
}

export async function addFxRate(app: Database, vndPerUsd: number, effectiveFrom: Date) {
  await app.db.insert(fxRates).values({ vndPerUsd, effectiveFrom });
}

/** Balance, Σ amounts and the latest "balance after", read as the company. */
export async function ledgerOf(app: Database, companyId: string) {
  return withCompany(app, companyId, async (tx) => {
    const { rows } = await tx.execute(
      sql.raw(`select (select balance_vnd from credit_accounts) as balance,
              (select coalesce(sum(amount_vnd), 0) from credit_transactions) as total,
              (select balance_after_vnd from credit_transactions order by created_at desc, id desc limit 1) as last_after,
              (select count(*) from credit_transactions) as transactions,
              (select count(*) from cost_entries) as costs`),
    );
    const row = rows[0] as Record<string, string | null>;
    return {
      balance: Number(row.balance),
      total: Number(row.total),
      lastAfter: row.last_after === null ? null : Number(row.last_after),
      transactions: Number(row.transactions),
      costs: Number(row.costs),
    };
  });
}

export const tokens = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});
