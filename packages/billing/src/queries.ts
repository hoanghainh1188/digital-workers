import { type CompanyTx, creditAccounts, memberProfiles } from '@dw/db';
import { and, eq, sql } from '@dw/db/drizzle';
import { vnDayRange, vnMonthOf, vnMonthRange } from './budget.ts';
import { type CreditState, creditState, lowThreshold } from './events.ts';
import type { CreditReason } from './ledger.ts';

/**
 * Read models for the Credit page (design D11, spec credit-ledger). Every query runs
 * inside withCompany, so RLS keeps it to one company; amounts are what the company
 * pays (multiplier applied). Real cost and multipliers are never returned (#074).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialStatus = 'granted' | 'pending_verification' | 'none';

export type CreditOverview = {
  readonly balanceVnd: number;
  readonly state: CreditState;
  readonly thresholdVnd: number;
  readonly month: { readonly usedVnd: number; readonly calls: number };
  /** Days the balance lasts at the last 7 days' pace; null without usage. */
  readonly estimatedDays: number | null;
  readonly trial: TrialStatus;
};

type Row = Record<string, unknown>;

async function rows<T extends Row>(tx: CompanyTx, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await tx.execute(query);
  return result.rows as T[];
}

async function usageBetween(tx: CompanyTx, start: Date, end: Date) {
  const [row] = await rows<{ used: string | null; calls: string }>(
    tx,
    sql`select -sum(t.amount_vnd) as used, count(*) as calls
        from credit_transactions t
        join cost_entries e on e.company_id = t.company_id and e.id = t.cost_entry_id
        where t.company_id = app.current_company_id() and t.kind = 'usage'
          and e.created_at >= ${start.toISOString()} and e.created_at < ${end.toISOString()}`,
  );
  return { usedVnd: Number(row?.used ?? 0), calls: Number(row?.calls ?? 0) };
}

export async function creditOverview(tx: CompanyTx, now: Date): Promise<CreditOverview> {
  const [account] = await tx
    .select()
    .from(creditAccounts)
    .where(sql`${creditAccounts.companyId} = app.current_company_id()`);
  const balanceVnd = account?.balanceVnd ?? 0;
  const lastCreditVnd = account?.lastCreditVnd ?? 0;
  const { start, end } = vnMonthRange(now);
  const month = await usageBetween(tx, start, end);
  const week = await usageBetween(tx, new Date(now.getTime() - 7 * DAY_MS), now);
  let estimatedDays: number | null = null;
  if (week.usedVnd > 0)
    estimatedDays = balanceVnd <= 0 ? 0 : Math.floor((balanceVnd * 7) / week.usedVnd);

  let trial: TrialStatus = 'granted';
  if (!account?.trialGrantedAt) {
    const unverifiedOwners = await tx
      .select({ id: memberProfiles.id })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.role, 'owner'), eq(memberProfiles.emailVerified, false)))
      .limit(1);
    trial = unverifiedOwners.length > 0 ? 'pending_verification' : 'none';
  }
  return {
    balanceVnd,
    state: creditState(balanceVnd, lastCreditVnd),
    thresholdVnd: lowThreshold(lastCreditVnd),
    month,
    estimatedDays,
    trial,
  };
}

export type HistoryFilter = 'all' | 'credit' | 'usage';

export type HistoryEntry =
  | {
      readonly type: 'credit';
      readonly id: string;
      readonly kind: 'trial' | 'adjustment';
      readonly amountVnd: number;
      readonly balanceAfterVnd: number;
      readonly reason: CreditReason | null;
      readonly note: string | null;
      readonly at: Date;
    }
  | {
      readonly type: 'usage';
      readonly workerId: string | null;
      readonly workerName: string | null;
      /** Vietnam calendar day, YYYY-MM-DD. */
      readonly date: string;
      readonly amountVnd: number;
      readonly calls: number;
      readonly balanceAfterVnd: number;
      readonly at: Date;
    };

/** Credits one per row; usage grouped per (worker, Vietnam day) (#072). Newest first. */
export async function creditHistory(
  tx: CompanyTx,
  month: string,
  filter: HistoryFilter,
): Promise<HistoryEntry[]> {
  const { start, end } = vnMonthOf(month);
  const entries: HistoryEntry[] = [];
  if (filter !== 'usage') {
    const credits = await rows<{
      id: string;
      kind: 'trial' | 'adjustment';
      amount_vnd: string;
      balance_after_vnd: string;
      reason: CreditReason | null;
      note: string | null;
      created_at: Date;
    }>(
      tx,
      sql`select id, kind, amount_vnd, balance_after_vnd, reason, note, created_at
          from credit_transactions
          where company_id = app.current_company_id() and kind <> 'usage'
            and created_at >= ${start.toISOString()} and created_at < ${end.toISOString()}`,
    );
    for (const row of credits) {
      entries.push({
        type: 'credit',
        id: row.id,
        kind: row.kind,
        amountVnd: Number(row.amount_vnd),
        balanceAfterVnd: Number(row.balance_after_vnd),
        reason: row.reason,
        note: row.note,
        at: new Date(row.created_at),
      });
    }
  }
  if (filter !== 'credit') {
    const groups = await rows<{
      worker_id: string | null;
      worker_name: string | null;
      day: string;
      amount: string;
      calls: string;
      last_at: Date;
      balance_after: string;
    }>(
      tx,
      // Grouped by the call time (cost_entries.created_at); "balance after" of the
      // group is the one of its latest ledger row.
      sql`select e.worker_id, w.name as worker_name,
                 to_char(e.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day,
                 sum(t.amount_vnd) as amount, count(*) as calls, max(e.created_at) as last_at,
                 (array_agg(t.balance_after_vnd order by t.created_at desc, t.id desc))[1] as balance_after
          from credit_transactions t
          join cost_entries e on e.company_id = t.company_id and e.id = t.cost_entry_id
          left join workers w on w.company_id = e.company_id and w.id = e.worker_id
          where t.company_id = app.current_company_id() and t.kind = 'usage'
            and e.created_at >= ${start.toISOString()} and e.created_at < ${end.toISOString()}
          group by e.worker_id, w.name, day`,
    );
    for (const row of groups) {
      entries.push({
        type: 'usage',
        workerId: row.worker_id,
        workerName: row.worker_name,
        date: row.day,
        amountVnd: Number(row.amount),
        calls: Number(row.calls),
        balanceAfterVnd: Number(row.balance_after),
        at: new Date(row.last_at),
      });
    }
  }
  return entries.sort((x, y) => y.at.getTime() - x.at.getTime());
}

export type UsageCall = {
  readonly id: string;
  readonly at: Date;
  readonly tokens: number;
  /** Whole đồng debited for this call. */
  readonly amountVnd: number;
};

/** Every call of one history group (worker or "no worker", Vietnam day). */
export async function usageCalls(
  tx: CompanyTx,
  date: string,
  workerId: string | null,
): Promise<UsageCall[]> {
  const { start, end } = vnDayRange(date);
  const workerFilter =
    workerId === null ? sql`e.worker_id is null` : sql`e.worker_id = ${workerId}`;
  const found = await rows<{ id: string; created_at: Date; tokens: string; amount_vnd: string }>(
    tx,
    sql`select e.id, e.created_at,
               (e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens) as tokens,
               -t.amount_vnd as amount_vnd
        from cost_entries e
        join credit_transactions t on t.company_id = e.company_id and t.cost_entry_id = e.id
        where e.company_id = app.current_company_id() and ${workerFilter}
          and e.created_at >= ${start.toISOString()} and e.created_at < ${end.toISOString()}
        order by e.created_at desc, e.id desc`,
  );
  return found.map((row) => ({
    id: row.id,
    at: new Date(row.created_at),
    tokens: Number(row.tokens),
    amountVnd: Number(row.amount_vnd),
  }));
}

/** True when the company's balance is ≤ 0 (banner in every page, spec credit-ledger). */
export async function isExhausted(tx: CompanyTx): Promise<boolean> {
  const [account] = await tx
    .select({ balance: creditAccounts.balanceVnd })
    .from(creditAccounts)
    .where(sql`${creditAccounts.companyId} = app.current_company_id()`);
  return (account?.balance ?? 0) <= 0;
}

export { vnMonthRange };
