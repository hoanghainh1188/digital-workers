import { randomUUID } from 'node:crypto';
import { priceMultipliers, withCompany } from '@dw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjustCredit, recordUsage } from '../src/ledger.ts';
import { creditHistory, creditOverview, isExhausted, usageCalls } from '../src/queries.ts';
import {
  addFxRate,
  addPrice,
  type BillingHarness,
  seedCompany,
  startBillingHarness,
  tokens,
} from './fixtures.ts';

let h: BillingHarness;
const PERIOD = new Date('2025-01-01T00:00:00Z');

beforeAll(async () => {
  h = await startBillingHarness();
  // 1.000đ / USD and × 1,00 in 2025: one cache-write token of price P costs P / 1.000 µđ.
  await addFxRate(h.app, 1000, PERIOD);
  await h.app.db.insert(priceMultipliers).values({ permille: 1000, effectiveFrom: PERIOD });
});

afterAll(async () => {
  await h?.stop();
});

async function price1000() {
  return addPrice(h.app, {
    model: `fixed-${randomUUID().slice(0, 8)}`,
    inputUsdMicrosPerMtok: 0,
    outputUsdMicrosPerMtok: 0,
    cacheReadUsdMicrosPerMtok: 0,
    cacheWriteUsdMicrosPerMtok: 1_000_000_000_000, // 1.000đ per token
    effectiveFrom: PERIOD,
  });
}

describe('credit page queries (task 4.7)', () => {
  it('groups 14 calls of one worker on one Vietnam day into one row, with 14 details', async () => {
    const a = await seedCompany(h.app, 'history');
    const b = await seedCompany(h.app, 'history-b');
    const workerId = randomUUID();
    const price = await price1000();
    await adjustCredit(h.app, {
      companyId: a.companyId,
      direction: 'credit',
      amountVnd: 1_000_000,
      reason: 'bank_transfer',
      note: 'Đã nhận CK 27/11',
      actorAdminId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    // 28/11/2025 in Vietnam: 01:00 → 23:00 local (18:00 UTC on 27/11 → 16:00 UTC on 28/11).
    for (let i = 0; i < 14; i += 1) {
      await recordUsage(h.app, {
        companyId: a.companyId,
        workerId,
        price,
        usage: tokens(0, 0, 0, 1),
        at: new Date(Date.UTC(2025, 10, 27, 18 + i)),
      });
    }
    // Company B's worker on the same day must never show up in A.
    const foreignWorker = randomUUID();
    await recordUsage(h.app, {
      companyId: b.companyId,
      workerId: foreignWorker,
      price,
      usage: tokens(0, 0, 0, 1),
      at: new Date(Date.UTC(2025, 10, 28, 3)),
    });

    const history = await withCompany(h.app, a.companyId, (tx) =>
      creditHistory(tx, '2025-11', 'all'),
    );
    const usage = history.filter((entry) => entry.type === 'usage');
    expect(usage).toEqual([
      expect.objectContaining({
        workerId,
        date: '2025-11-28',
        amountVnd: -14_000,
        calls: 14,
        balanceAfterVnd: 986_000,
      }),
    ]);
    // Credits are stamped with the real time, so they are in the current month.
    const thisMonth = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    const credits = await withCompany(h.app, a.companyId, (tx) =>
      creditHistory(tx, thisMonth, 'all'),
    );
    expect(credits).toEqual([
      expect.objectContaining({
        kind: 'adjustment',
        amountVnd: 1_000_000,
        reason: 'bank_transfer',
        note: 'Đã nhận CK 27/11',
        balanceAfterVnd: 1_000_000,
      }),
    ]);
    expect(JSON.stringify(history)).not.toMatch(/real|multiplier|permille|micro/i);

    const onlyCredits = await withCompany(h.app, a.companyId, (tx) =>
      creditHistory(tx, '2025-11', 'credit'),
    );
    expect(onlyCredits.every((entry) => entry.type === 'credit')).toBe(true);
    const onlyUsage = await withCompany(h.app, a.companyId, (tx) =>
      creditHistory(tx, '2025-11', 'usage'),
    );
    expect(onlyUsage.every((entry) => entry.type === 'usage')).toBe(true);

    const calls = await withCompany(h.app, a.companyId, (tx) =>
      usageCalls(tx, '2025-11-28', workerId),
    );
    expect(calls).toHaveLength(14);
    expect(calls[0]).toEqual(expect.objectContaining({ tokens: 1, amountVnd: 1000 }));
    expect(Object.keys(calls[0] ?? {}).sort()).toEqual(['amountVnd', 'at', 'id', 'tokens']);

    // Company B's worker id in A's context: nothing.
    const foreign = await withCompany(h.app, a.companyId, (tx) =>
      usageCalls(tx, '2025-11-28', foreignWorker),
    );
    expect(foreign).toEqual([]);
  });

  it('overview: balance, state, threshold, month usage and estimated days', async () => {
    const { companyId } = await seedCompany(h.app, 'overview');
    const price = await price1000();
    await adjustCredit(h.app, {
      companyId,
      direction: 'credit',
      amountVnd: 100_000,
      reason: 'other',
      note: 'x',
      actorAdminId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    const now = new Date('2025-06-20T05:00:00Z');
    for (let day = 1; day <= 7; day += 1) {
      await recordUsage(h.app, {
        companyId,
        price,
        usage: tokens(0, 0, 0, 1),
        at: new Date(now.getTime() - day * 60 * 60 * 1000),
      });
    }
    const overview = await withCompany(h.app, companyId, (tx) => creditOverview(tx, now));
    expect(overview).toEqual({
      balanceVnd: 93_000,
      state: 'normal',
      thresholdVnd: 20_000,
      month: { usedVnd: 7000, calls: 7 },
      estimatedDays: 93, // 93.000đ at 7.000đ per 7 days
      trial: 'pending_verification',
    });
    expect(await withCompany(h.app, companyId, isExhausted)).toBe(false);
  });

  it('overview without any usage has no estimate; a 0đ company is exhausted', async () => {
    const { companyId } = await seedCompany(h.app, 'empty', { verified: true });
    const overview = await withCompany(h.app, companyId, (tx) => creditOverview(tx, new Date()));
    expect(overview).toMatchObject({
      balanceVnd: 0,
      state: 'exhausted',
      estimatedDays: null,
      trial: 'none',
    });
    expect(await withCompany(h.app, companyId, isExhausted)).toBe(true);
  });
});
