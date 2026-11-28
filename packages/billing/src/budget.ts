import { type CompanyTx, costEntries } from '@dw/db';
import { and, eq, sql } from '@dw/db/drizzle';
import { floorVnd } from './pricing.ts';

/** Vietnam has no DST: UTC+7 all year. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** [start, end) in UTC of the calendar month (Vietnam time) containing `at`. */
export function vnMonthRange(at: Date): { start: Date; end: Date } {
  const local = new Date(at.getTime() + VN_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS),
  };
}

/** [start, end) in UTC of the calendar day (Vietnam time) `YYYY-MM-DD`. */
export function vnDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+07:00`);
  // V8 rolls 2026-02-31 over to 3 March: round-trip to refuse impossible dates.
  if (Number.isNaN(start.getTime())) throw new RangeError('invalid date');
  const back = new Date(start.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
  if (back !== date) throw new RangeError('invalid date');
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** [start, end) in UTC of month `YYYY-MM` (Vietnam time). */
export function vnMonthOf(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}-01T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) throw new RangeError('invalid month');
  return vnMonthRange(start);
}

/**
 * The worker's spend this month (design D7): Σ charge of its CostEntries in the
 * Vietnam calendar month of `at`, rounded down to đồng. RLS limits it to the
 * transaction's company, so another company's context sees 0đ.
 */
export async function workerMonthSpend(tx: CompanyTx, workerId: string, at: Date): Promise<number> {
  const { start, end } = vnMonthRange(at);
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${costEntries.chargeMicroVnd}), 0)` })
    .from(costEntries)
    .where(
      and(
        eq(costEntries.workerId, workerId),
        sql`${costEntries.createdAt} >= ${start.toISOString()}`,
        sql`${costEntries.createdAt} < ${end.toISOString()}`,
      ),
    );
  return floorVnd(BigInt(row?.total ?? '0'));
}

export type BudgetCheck =
  | { readonly ok: true; readonly remainingVnd: number }
  | { readonly ok: false };

/** Spend ≥ budget = out of budget (#018). Only checked when a worker takes new work. */
export function checkWorkerBudget(spendVnd: number, budgetVnd: number): BudgetCheck {
  return spendVnd >= budgetVnd ? { ok: false } : { ok: true, remainingVnd: budgetVnd - spendVnd };
}
