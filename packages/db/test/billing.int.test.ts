import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  companies,
  costEntries,
  createDatabase,
  creditAccounts,
  creditTransactions,
  type Database,
  members,
  modelPrices,
  withCompany,
} from '../src/index.ts';
import { migrationsFolder, runMigrations } from '../src/migrate.ts';
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

async function seedCompany(app: Database, label: string, verified = false) {
  const userId = randomUUID();
  await app.pool.query(
    'insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, $4)',
    [userId, `Owner ${label}`, `${label}-${userId}@example.com`, verified],
  );
  const companyId = randomUUID();
  await withCompany(app, companyId, async (tx) => {
    await tx.insert(companies).values({ id: companyId, name: `Company ${label}` });
    await tx.insert(members).values({ companyId, userId, role: 'owner' });
    await tx.insert(creditAccounts).values({ companyId });
  });
  return { companyId, userId };
}

describe('credit tables (dw_app)', () => {
  let pgTest: TestPostgres;
  let app: Database;
  let a: { companyId: string };
  let b: { companyId: string };
  let priceId: string;

  beforeAll(async () => {
    pgTest = await startTestPostgres();
    app = createDatabase(pgTest.appUrl, { max: 2 });
    a = await seedCompany(app, 'a');
    b = await seedCompany(app, 'b');
    const [price] = await app.db
      .insert(modelPrices)
      .values({
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        inputUsdMicrosPerMtok: 3_000_000,
        outputUsdMicrosPerMtok: 15_000_000,
        cacheReadUsdMicrosPerMtok: 300_000,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning({ id: modelPrices.id });
    priceId = price?.id ?? '';
    for (const tenant of [a, b]) {
      await withCompany(app, tenant.companyId, async (tx) => {
        const [entry] = await tx
          .insert(costEntries)
          .values({
            companyId: tenant.companyId,
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            priceId,
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            vndPerUsd: 25400,
            multiplierPermille: 1300,
            realCostMicroVnd: 266_700_000n,
            chargeMicroVnd: 346_710_000n,
          })
          .returning({ id: costEntries.id });
        await tx.insert(creditTransactions).values({
          companyId: tenant.companyId,
          kind: 'usage',
          amountVnd: -346,
          balanceAfterVnd: -346,
          costEntryId: entry?.id ?? null,
        });
      });
    }
  });

  afterAll(async () => {
    await app?.close();
    await pgTest?.stop();
  });

  it('seeds the exchange rate and the default multiplier, but no model price (0.2 #102)', async () => {
    const owner = createDatabase(pgTest.ownerUrl, { max: 1 });
    try {
      const fx = await owner.pool.query('select vnd_per_usd from fx_rates');
      const mult = await owner.pool.query('select permille from price_multipliers');
      expect(fx.rows).toEqual([{ vnd_per_usd: 25400 }]);
      expect(mult.rows).toEqual([{ permille: 1300 }]);
    } finally {
      await owner.close();
    }
  });

  it.each([
    'credit_transactions',
    'cost_entries',
    'model_prices',
    'fx_rates',
    'price_multipliers',
    'platform_audit_events',
  ])('%s is append-only: UPDATE and DELETE are refused', async (table) => {
    expect(await dbError(app.pool.query(`update ${table} set created_at = now()`))).toMatch(
      /permission denied/,
    );
    expect(await dbError(app.pool.query(`delete from ${table}`))).toMatch(/permission denied/);
    expect(await dbError(app.pool.query(`truncate ${table}`))).toMatch(/permission denied/);
  });

  it('credit accounts and provider keys cannot be deleted', async () => {
    expect(await dbError(app.pool.query('delete from credit_accounts'))).toMatch(
      /permission denied/,
    );
    expect(await dbError(app.pool.query('delete from provider_keys'))).toMatch(/permission denied/);
  });

  it('company A sees only its own account, transactions and cost entries', async () => {
    const seen = await withCompany(app, a.companyId, async (tx) => ({
      accounts: await tx.select({ id: creditAccounts.companyId }).from(creditAccounts),
      transactions: await tx.select({ id: creditTransactions.companyId }).from(creditTransactions),
      costs: await tx.select({ id: costEntries.companyId }).from(costEntries),
    }));
    expect(seen.accounts).toEqual([{ id: a.companyId }]);
    expect(seen.transactions).toEqual([{ id: a.companyId }]);
    expect(seen.costs).toEqual([{ id: a.companyId }]);
  });

  it('without a company nothing is visible', async () => {
    const { rows } = await app.pool.query('select count(*)::int as n from credit_transactions');
    expect(rows[0].n).toBe(0);
  });

  it("company A cannot insert rows carrying company B's id", async () => {
    const message = await dbError(
      withCompany(app, a.companyId, (tx) =>
        tx.insert(creditTransactions).values({
          companyId: b.companyId,
          kind: 'trial',
          amountVnd: 200_000,
          balanceAfterVnd: 200_000,
          reason: 'trial',
        }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('a second trial transaction for the same company is refused', async () => {
    const insertTrial = () =>
      withCompany(app, b.companyId, (tx) =>
        tx.insert(creditTransactions).values({
          companyId: b.companyId,
          kind: 'trial',
          amountVnd: 200_000,
          balanceAfterVnd: 200_000,
          reason: 'trial',
        }),
      );
    await insertTrial();
    expect(await dbError(insertTrial())).toMatch(/credit_transactions_one_trial_uq/);
  });

  it('the same idempotency key cannot be used twice in a company', async () => {
    const adjust = () =>
      withCompany(app, b.companyId, (tx) =>
        tx.insert(creditTransactions).values({
          companyId: b.companyId,
          kind: 'adjustment',
          amountVnd: 1000,
          balanceAfterVnd: 1000,
          reason: 'other',
          note: 'test',
          idempotencyKey: 'key-1',
        }),
      );
    await adjust();
    expect(await dbError(adjust())).toMatch(/credit_transactions_idempotency_unique/);
  });

  it('an adjustment needs a reason and a note', async () => {
    const message = await dbError(
      withCompany(app, b.companyId, (tx) =>
        tx.insert(creditTransactions).values({
          companyId: b.companyId,
          kind: 'adjustment',
          amountVnd: 1000,
          balanceAfterVnd: 1000,
        }),
      ),
    );
    expect(message).toMatch(/credit_transactions_adjustment_shape/);
  });

  it('a usage transaction cannot point at a cost entry of another company', async () => {
    const [foreign] = await withCompany(app, a.companyId, (tx) =>
      tx.select({ id: costEntries.id }).from(costEntries),
    );
    const message = await dbError(
      withCompany(app, b.companyId, (tx) =>
        tx.insert(creditTransactions).values({
          companyId: b.companyId,
          kind: 'usage',
          amountVnd: -1,
          balanceAfterVnd: -1,
          costEntryId: foreign?.id ?? null,
        }),
      ),
    );
    expect(message).toMatch(/foreign key|credit_transactions_cost_entry/);
  });

  it('platform_company_summaries returns only the aggregate columns', async () => {
    const { rows, fields } = await app.pool.query(
      'select * from app.platform_company_summaries() order by name',
    );
    expect(fields.map((field) => field.name)).toEqual([
      'company_id',
      'name',
      'owner_email',
      'balance_vnd',
      'last_credit_vnd',
      'charged_30d_vnd',
      'real_cost_30d_microvnd',
      'multiplier_permille',
      'last_used_at',
      'created_at',
    ]);
    const rowA = rows.find((row) => row.company_id === a.companyId);
    expect(rowA).toMatchObject({
      name: 'Company a',
      balance_vnd: '0',
      charged_30d_vnd: '346',
      real_cost_30d_microvnd: '266700000',
      multiplier_permille: null,
    });
    expect(rowA.owner_email).toMatch(/^a-/);
  });

  it('dw_app reading the tables directly is still limited by RLS', async () => {
    const { rows } = await app.pool.query('select count(*)::int as n from cost_entries');
    expect(rows[0].n).toBe(0);
  });
});

describe('migration on a database with data from before this change', () => {
  let pgTest: TestPostgres;
  let folder: string;

  beforeAll(async () => {
    pgTest = await startTestPostgres({ migrate: false });
    // Apply every migration except 0006, seed companies, then apply 0006.
    folder = await mkdtemp(join(tmpdir(), 'dw-migrations-'));
    await cp(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(pgTest.ownerUrl, folder);
    await writeFile(journalPath, JSON.stringify(full));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
    await pgTest?.stop();
  });

  it('creates a 0đ account for every company and the trial for verified Owners (#104)', async () => {
    const app = createDatabase(pgTest.appUrl, { max: 1 });
    try {
      const verified = await seedLegacy(app, 'verified', true);
      const unverified = await seedLegacy(app, 'unverified', false);
      await runMigrations(pgTest.ownerUrl, folder);

      const read = (companyId: string) =>
        withCompany(app, companyId, async (tx) => ({
          account: await tx
            .select({ balance: creditAccounts.balanceVnd, last: creditAccounts.lastCreditVnd })
            .from(creditAccounts),
          transactions: await tx
            .select({ kind: creditTransactions.kind, amount: creditTransactions.amountVnd })
            .from(creditTransactions),
        }));
      expect(await read(verified)).toEqual({
        account: [{ balance: 200_000, last: 200_000 }],
        transactions: [{ kind: 'trial', amount: 200_000 }],
      });
      expect(await read(unverified)).toEqual({
        account: [{ balance: 0, last: 0 }],
        transactions: [],
      });
    } finally {
      await app.close();
    }
  });
});

/** A company created the way change 1a did (no credit account). */
async function seedLegacy(app: Database, label: string, verified: boolean): Promise<string> {
  const userId = randomUUID();
  await app.pool.query(
    'insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, $4)',
    [userId, label, `${label}-${userId}@example.com`, verified],
  );
  const companyId = randomUUID();
  const client = await app.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    await client.query('insert into companies (id, name) values ($1, $2)', [companyId, label]);
    await client.query("insert into members (company_id, user_id, role) values ($1, $2, 'owner')", [
      companyId,
      userId,
    ]);
    await client.query('commit');
  } finally {
    client.release();
  }
  return companyId;
}
