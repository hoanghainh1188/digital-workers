import { queryOptions } from '@tanstack/react-query';
import { api } from './api.ts';

/** Shapes of /api/credit* (apps/api/src/routes/credit.ts). Amounts are whole đồng. */
export type CreditState = 'normal' | 'low' | 'exhausted';
export type CreditReason = 'bank_transfer' | 'trial' | 'system_fix' | 'other';

export type CreditOverview = {
  balanceVnd: number;
  state: CreditState;
  thresholdVnd: number;
  month: { usedVnd: number; calls: number };
  estimatedDays: number | null;
  trial: 'granted' | 'pending_verification' | 'none';
};

export type HistoryEntry =
  | {
      type: 'credit';
      id: string;
      kind: 'trial' | 'adjustment';
      amountVnd: number;
      balanceAfterVnd: number;
      reason: CreditReason | null;
      note: string | null;
      at: string;
    }
  | {
      type: 'usage';
      workerId: string | null;
      workerName: string | null;
      date: string;
      amountVnd: number;
      calls: number;
      balanceAfterVnd: number;
      at: string;
    };

export type UsageCall = { id: string; at: string; tokens: number; amountVnd: number };
export type HistoryFilter = 'all' | 'credit' | 'usage';

export const creditOverviewQuery = queryOptions({
  queryKey: ['credit', 'overview'],
  queryFn: () => api<CreditOverview>('/api/credit'),
});

export const creditHistoryQuery = (month: string, type: HistoryFilter) =>
  queryOptions({
    queryKey: ['credit', 'history', month, type],
    queryFn: () =>
      api<{ entries: HistoryEntry[] }>(
        `/api/credit/transactions?month=${encodeURIComponent(month)}&type=${type}`,
      ),
  });

export const usageCallsQuery = (date: string, workerId: string | null) =>
  queryOptions({
    queryKey: ['credit', 'usage', date, workerId],
    queryFn: () =>
      api<{ calls: UsageCall[] }>(
        `/api/credit/usage?date=${encodeURIComponent(date)}${workerId ? `&workerId=${workerId}` : ''}`,
      ),
  });

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Vietnam-time "YYYY-MM-DD" of an ISO instant. */
export function vnDate(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Vietnam-time "HH:mm" of an ISO instant. */
export function vnTime(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);
}

/** The current Vietnam month and the 5 before it, newest first ("YYYY-MM"). */
export function recentMonths(now = new Date(), count = 6): string[] {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - i, 1));
    return date.toISOString().slice(0, 7);
  });
}

/** "2026-11" → "11/2026"; "2026-11-28" → "28/11". */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${m}/${year}`;
}
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}
