import { queryOptions } from '@tanstack/react-query';
import { api } from './api.ts';
import type { CreditReason, CreditState } from './credit.ts';

/** Shapes of /api/platform/* (apps/api/src/routes/platform.ts). */
export type Provider = 'anthropic' | 'openai';
export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai'];

export type CompanySummary = {
  id: string;
  name: string;
  ownerEmail: string | null;
  balanceVnd: number;
  charged30dVnd: number;
  state: CreditState;
  multiplierPermille: number | null;
  lastUsedAt: string | null;
};

export type CompanyList = {
  companies: CompanySummary[];
  totals: {
    companies: number;
    balanceVnd: number;
    charged30dVnd: number;
    realCost30dVnd: number;
    exhausted: number;
  };
};

export type ModelPriceRow = {
  id: string;
  provider: Provider;
  model: string;
  inputUsdMicrosPerMtok: number;
  outputUsdMicrosPerMtok: number;
  cacheReadUsdMicrosPerMtok: number;
  cacheWriteUsdMicrosPerMtok: number | null;
  effectiveFrom: string;
  status: 'current' | 'scheduled' | 'superseded';
};

export type PriceBook = {
  fxRate: number;
  defaultMultiplierPermille: number;
  prices: ModelPriceRow[];
};

export type KeyStatus = {
  provider: Provider;
  configured: boolean;
  updatedAt: string | null;
  lastOkAt: string | null;
};

export type CompanyFilter = 'all' | CreditState;

export const companiesQuery = (state: CompanyFilter, q: string) =>
  queryOptions({
    queryKey: ['platform', 'companies', state, q],
    queryFn: () => {
      const params = new URLSearchParams({ state });
      if (q) params.set('q', q);
      return api<CompanyList>(`/api/platform/companies?${params}`);
    },
  });

export const priceBookQuery = queryOptions({
  queryKey: ['platform', 'prices'],
  queryFn: () => api<PriceBook>('/api/platform/model-prices'),
});

export const keysQuery = queryOptions({
  queryKey: ['platform', 'keys'],
  queryFn: () => api<{ keys: KeyStatus[] }>('/api/platform/provider-keys'),
});

export type AdjustmentInput = {
  direction: 'credit' | 'debit';
  amountVnd: number;
  reason: CreditReason;
  note: string;
};

/** One adjustment; `idempotencyKey` is fixed per dialog opening so a retry is never doubled. */
export function postAdjustment(companyId: string, input: AdjustmentInput, idempotencyKey: string) {
  return api<{ id: string }>(`/api/platform/companies/${companyId}/credit-adjustments`, {
    method: 'POST',
    body: input,
    headers: { 'idempotency-key': idempotencyKey },
  });
}
