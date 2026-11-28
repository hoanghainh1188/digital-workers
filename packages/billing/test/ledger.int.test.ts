import { randomUUID } from 'node:crypto';
import { costEntries, creditTransactions, priceMultipliers, withCompany } from '@dw/db';
import { eq } from '@dw/db/drizzle';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkWorkerBudget,
  type EffectivePrice,
  effectiveDefaultMultiplier,
  effectiveFxRate,
  effectivePrice,
  workerMonthSpend,
} from '../src/index.ts';
import {
  adjustCredit,
  grantTrial,
  InsufficientBalanceError,
  readBalance,
  recordUsage,
  setCompanyMultiplier,
} from '../src/ledger.ts';
import {
  addFxRate,
  addPrice,
  type BillingHarness,
  ledgerOf,
  seedCompany,
  startBillingHarness,
  tokens,
} from './fixtures.ts';

const LONG_AGO = new Date('2020-01-01T00:00:00Z');
/** Real-world rates (25.400đ, × 1,30) apply from 2026; NOW is in that period. */
const RATES_2026 = new Date('2026-01-01T00:00:00Z');
const NOW = new Date('2026-11-28T03:00:00Z');
/**
 * 2025 uses 1.000đ / USD and × 1,00 so that a call can cost an exact number of đồng
 * (25.400 × 1.300 has the prime factor 127, so exact amounts are impossible there).
 */
const FIXED_PERIOD = new Date('2025-01-01T00:00:00Z');
const FIXED_AT = new Date('2025-06-01T03:00:00Z');

let h: BillingHarness;
let sonnet: EffectivePrice;

/** Credits through the admin path (the only way to add money besides the trial). */
async function credit(companyId: string, amountVnd: number) {
  return adjustCredit(h.app, {
    companyId,
    direction: 'credit',
    amountVnd,
    reason: 'bank_transfer',
    note: 'test',
    actorAdminId: randomUUID(),
    idempotencyKey: randomUUID(),
  });
}

/**
 * A price whose single cache-write token costs exactly `vnd` đồng at FIXED_AT:
 * charge µđ = 1 × P × 1.000 × 1.000 / 10⁹ = P / 1.000 → P = vnd × 10⁹.
 */
async function priceForVnd(vnd: number): Promise<EffectivePrice> {
  return addPrice(h.app, {
    model: `fixed-${randomUUID().slice(0, 8)}`,
    inputUsdMicrosPerMtok: 0,
    outputUsdMicrosPerMtok: 0,
    cacheReadUsdMicrosPerMtok: 0,
    cacheWriteUsdMicrosPerMtok: Math.round(vnd * 1_000_000_000),
    effectiveFrom: LONG_AGO,
  });
}

/** One fixed-price call at FIXED_AT (or `at`). */
function charge(companyId: string, price: EffectivePrice, at = FIXED_AT, workerId?: string) {
  return recordUsage(h.app, { companyId, workerId, price, usage: tokens(0, 0, 0, 1), at });
}

beforeAll(async () => {
  h = await startBillingHarness();
  await addFxRate(h.app, 1000, FIXED_PERIOD);
  await h.app.db.insert(priceMultipliers).values({ permille: 1000, effectiveFrom: FIXED_PERIOD });
  await addFxRate(h.app, 25_400, RATES_2026);
  await h.app.db.insert(priceMultipliers).values({ permille: 1300, effectiveFrom: RATES_2026 });
  sonnet = await addPrice(h.app);
});

afterAll(async () => {
  await h?.stop();
});

describe('effective price, rate and multiplier (task 3.3)', () => {
  it('uses the newest price that has started', async () => {
    const model = `gpt-5.5-mini-${randomUUID().slice(0, 6)}`;
    await addPrice(h.app, {
      provider: 'openai',
      model,
      inputUsdMicrosPerMtok: 500_000,
      effectiveFrom: new Date('2026-10-01T00:00:00+07:00'),
    });
    await addPrice(h.app, {
      provider: 'openai',
      model,
      inputUsdMicrosPerMtok: 400_000,
      effectiveFrom: new Date('2026-12-01T00:00:00+07:00'),
    });
    const at = (iso: string) => effectivePrice(h.app.db, 'openai', model, new Date(iso));
    expect((await at('2026-12-02T00:00:00+07:00'))?.inputUsdMicrosPerMtok).toBe(400_000);
    expect((await at('2026-11-15T00:00:00+07:00'))?.inputUsdMicrosPerMtok).toBe(500_000);
    expect(await at('2026-09-30T00:00:00+07:00')).toBeNull();
  });

  it('reads the current exchange rate and default multiplier', async () => {
    expect(await effectiveFxRate(h.app.db, NOW)).toBe(25_400);
    expect(await effectiveDefaultMultiplier(h.app.db, NOW)).toBe(1300);
  });

  it('a company multiplier wins, and clearing it falls back to the default', async () => {
    const { companyId } = await seedCompany(h.app, 'mult');
    await credit(companyId, 100_000);
    await setCompanyMultiplier(h.app, companyId, 1150);
    const own = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: NOW,
    });
    expect(own.multiplierPermille).toBe(1150);
    await setCompanyMultiplier(h.app, companyId, null);
    const back = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: NOW,
    });
    expect(back.multiplierPermille).toBe(1300);
  });

  it('a new exchange rate does not change old cost entries (spec "Không tính lại")', async () => {
    const { companyId } = await seedCompany(h.app, 'fx');
    await credit(companyId, 100_000);
    const before = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: NOW,
    });
    await addFxRate(h.app, 26_000, new Date(NOW.getTime() + 1000));
    const after = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: new Date(NOW.getTime() + 2000),
    });
    expect(after.vndPerUsd).toBe(26_000);
    const [old] = await withCompany(h.app, companyId, (tx) =>
      tx.select().from(costEntries).orderBy(costEntries.createdAt).limit(1),
    );
    expect(old?.id).toBe(before.costEntryId);
    expect(old?.vndPerUsd).toBe(25_400);
    expect(old?.chargeMicroVnd).toBe(346_710_000n);
  });
});

describe('recordUsage (task 4.1)', () => {
  it('writes one CostEntry and one transaction = tokens × price × rate × multiplier', async () => {
    const { companyId } = await seedCompany(h.app, 'usage');
    await credit(companyId, 100_000);
    const first = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: NOW,
    });
    expect(first).toMatchObject({
      debitVnd: 346,
      balanceAfterVnd: 99_654,
      vndPerUsd: 25_400,
      multiplierPermille: 1300,
      realMicroVnd: 266_700_000n,
      chargeMicroVnd: 346_710_000n,
    });
    const second = await recordUsage(h.app, {
      companyId,
      price: sonnet,
      usage: tokens(1000, 500),
      at: NOW,
    });
    expect(second.debitVnd).toBe(347);

    const [entry] = await withCompany(h.app, companyId, (tx) =>
      tx.select().from(costEntries).where(eq(costEntries.id, first.costEntryId)),
    );
    expect(entry).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      priceId: sonnet.id,
      inputTokens: 1000,
      outputTokens: 500,
      realCostMicroVnd: 266_700_000n,
      chargeMicroVnd: 346_710_000n,
    });
    const ledger = await ledgerOf(h.app, companyId);
    expect(ledger).toEqual({
      balance: 99_307,
      total: 99_307,
      lastAfter: 99_307,
      transactions: 3,
      costs: 2,
    });
  });

  it('a call under 1đ still gets a 0đ transaction and carries the fraction', async () => {
    const { companyId } = await seedCompany(h.app, 'tiny');
    await credit(companyId, 1000);
    const tiny = await priceForVnd(0.4);
    const result = await charge(companyId, tiny);
    expect(result.chargeMicroVnd).toBe(400_000n);
    expect(result.debitVnd).toBe(0);
    expect((await ledgerOf(h.app, companyId)).transactions).toBe(2);
  });

  it('charges a finished call in full, even below zero (0.2 #095)', async () => {
    const { companyId } = await seedCompany(h.app, 'negative');
    await credit(companyId, 200);
    const price = await priceForVnd(350);
    const result = await charge(companyId, price);
    expect(result.balanceAfterVnd).toBe(-150);
    expect(result.events).toEqual([{ type: 'exhausted' }]);
    expect(await readBalance(h.app, companyId)).toBe(-150);

    // Crediting while negative (spec "Cộng credit khi đang âm").
    const topped = await credit(companyId, 100_000);
    expect(topped.transaction.balanceAfterVnd).toBe(99_850);
    const ledger = await ledgerOf(h.app, companyId);
    expect(ledger.balance).toBe(ledger.total);
  });
});

describe('concurrent debits (task 4.2)', () => {
  it('two debits of 1.000đ from 10.000đ leave 8.000đ, with 9.000đ and 8.000đ after', async () => {
    const { companyId } = await seedCompany(h.app, 'pair');
    await credit(companyId, 10_000);
    const price = await priceForVnd(1000);
    const results = await Promise.all([1, 2].map(() => charge(companyId, price)));
    expect(results.map((r) => r.balanceAfterVnd).sort()).toEqual([8000, 9000]);
    expect(await readBalance(h.app, companyId)).toBe(8000);
  });

  it('20 parallel debits: correct balance and a gap-free run of "balance after"', async () => {
    const { companyId } = await seedCompany(h.app, 'twenty');
    await credit(companyId, 100_000);
    const price = await priceForVnd(1000);
    const results = await Promise.all(Array.from({ length: 20 }, () => charge(companyId, price)));
    const afters = results.map((r) => r.balanceAfterVnd).sort((x, y) => y - x);
    expect(afters).toEqual(Array.from({ length: 20 }, (_, i) => 99_000 - i * 1000));
    const ledger = await ledgerOf(h.app, companyId);
    expect(ledger.balance).toBe(80_000);
    expect(ledger.total).toBe(80_000);
  });
});

describe('manual adjustments (task 4.3)', () => {
  it('refuses a debit above the balance and keeps the balance', async () => {
    const { companyId } = await seedCompany(h.app, 'debit');
    await credit(companyId, 86_200);
    await expect(
      adjustCredit(h.app, {
        companyId,
        direction: 'debit',
        amountVnd: 100_000,
        reason: 'system_fix',
        note: 'x',
        actorAdminId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(await readBalance(h.app, companyId)).toBe(86_200);
  });

  it('the same idempotency key twice gives one transaction, the second replays the first', async () => {
    const { companyId } = await seedCompany(h.app, 'idem');
    const input = {
      companyId,
      direction: 'credit' as const,
      amountVnd: 2_000_000,
      reason: 'bank_transfer' as const,
      note: 'Đã nhận CK',
      actorAdminId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const [one, two] = await Promise.all([adjustCredit(h.app, input), adjustCredit(h.app, input)]);
    expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
    expect(one.transaction.id).toBe(two.transaction.id);
    expect(await ledgerOf(h.app, companyId)).toMatchObject({ balance: 2_000_000, transactions: 1 });
  });

  it('rejects amounts that are not positive integers or above 100.000.000đ', async () => {
    const { companyId } = await seedCompany(h.app, 'limits');
    const base = {
      companyId,
      direction: 'credit' as const,
      reason: 'other' as const,
      note: 'x',
      actorAdminId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    await expect(adjustCredit(h.app, { ...base, amountVnd: 0 })).rejects.toThrow(RangeError);
    await expect(adjustCredit(h.app, { ...base, amountVnd: 1.5 })).rejects.toThrow(RangeError);
    await expect(adjustCredit(h.app, { ...base, amountVnd: 100_000_001 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('trial credit (task 4.4)', () => {
  it('two parallel grants give one +200.000đ transaction', async () => {
    const { companyId } = await seedCompany(h.app, 'trial');
    const granted = await Promise.all([grantTrial(h.app, companyId), grantTrial(h.app, companyId)]);
    expect(granted.sort()).toEqual([false, true]);
    expect(await grantTrial(h.app, companyId)).toBe(false);
    const rows = await withCompany(h.app, companyId, (tx) =>
      tx
        .select({ kind: creditTransactions.kind, amount: creditTransactions.amountVnd })
        .from(creditTransactions),
    );
    expect(rows).toEqual([{ kind: 'trial', amount: 200_000 }]);
  });
});

describe('low / exhausted events through the ledger (task 4.5)', () => {
  it('fires "low" once under 20% of the last credit, and again after a new credit', async () => {
    const { companyId } = await seedCompany(h.app, 'low');
    await credit(companyId, 1_000_000);
    const big = await priceForVnd(799_000);
    expect((await charge(companyId, big)).events).toEqual([]);
    const small = await priceForVnd(2000);
    const crossing = await charge(companyId, small);
    expect(crossing.events).toEqual([{ type: 'low', balanceVnd: 199_000, thresholdVnd: 200_000 }]);
    const again = await charge(companyId, small);
    expect(again.events).toEqual([]);

    await credit(companyId, 500_000); // 697.000đ, new threshold 100.000đ
    const drop = await priceForVnd(598_000);
    const recrossed = await charge(companyId, drop);
    expect(recrossed.events).toEqual([{ type: 'low', balanceVnd: 99_000, thresholdVnd: 100_000 }]);
  });
});

describe('worker month spend (task 4.6, spec worker-budget)', () => {
  it('counts by Vietnam calendar month', async () => {
    const { companyId } = await seedCompany(h.app, 'budget');
    const workerId = randomUUID();
    await credit(companyId, 1_000_000);
    const price = await priceForVnd(1000);
    const call = (iso: string) => charge(companyId, price, new Date(iso), workerId);
    await call('2025-11-30T16:30:00Z'); // 23:30 30/11 VN → November
    await call('2025-11-30T17:10:00Z'); // 00:10 01/12 VN → December

    const spend = (iso: string, company = companyId) =>
      withCompany(h.app, company, (tx) => workerMonthSpend(tx, workerId, new Date(iso)));
    expect(await spend('2025-11-15T00:00:00Z')).toBe(1000);
    expect(await spend('2025-12-15T00:00:00Z')).toBe(1000);
    expect(await spend('2026-01-15T00:00:00Z')).toBe(0);

    const other = await seedCompany(h.app, 'budget-b');
    expect(await spend('2025-11-15T00:00:00Z', other.companyId)).toBe(0);
  });

  it('budget check: equal = out of budget, otherwise the remainder', () => {
    expect(checkWorkerBudget(268_900, 300_000)).toEqual({ ok: true, remainingVnd: 31_100 });
    expect(checkWorkerBudget(300_000, 300_000)).toEqual({ ok: false });
    expect(checkWorkerBudget(0, 300_000)).toEqual({ ok: true, remainingVnd: 300_000 });
  });
});
