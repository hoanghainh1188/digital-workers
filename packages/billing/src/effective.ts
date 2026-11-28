import { type Database, fxRates, modelPrices, priceMultipliers } from '@dw/db';
import { and, desc, eq, sql } from '@dw/db/drizzle';
import type { ModelPrice } from './pricing.ts';

/** The provider ids the platform supports (NFR-09: adding one = config + prices). */
export const PROVIDERS = ['anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type EffectivePrice = ModelPrice & {
  readonly id: string;
  readonly provider: Provider;
  readonly model: string;
  readonly effectiveFrom: Date;
};

type Db = Pick<Database, 'db'>;
type Reader = Db['db'] | Parameters<Parameters<Db['db']['transaction']>[0]>[0];

/** The row in effect at `at`: latest `effectiveFrom` not later than `at` (spec model-pricing). */
export function pickEffective<T extends { readonly effectiveFrom: Date }>(
  rows: readonly T[],
  at: Date,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || row.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = row;
  }
  return best;
}

/** Price of `provider/model` in effect at `at`, or null (the gateway then refuses the call). */
export async function effectivePrice(
  reader: Reader,
  provider: Provider,
  model: string,
  at: Date,
): Promise<EffectivePrice | null> {
  const [row] = await reader
    .select()
    .from(modelPrices)
    .where(
      and(
        eq(modelPrices.provider, provider),
        eq(modelPrices.model, model),
        sql`${modelPrices.effectiveFrom} <= ${at.toISOString()}`,
      ),
    )
    .orderBy(desc(modelPrices.effectiveFrom))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider as Provider,
    model: row.model,
    effectiveFrom: row.effectiveFrom,
    inputUsdMicrosPerMtok: row.inputUsdMicrosPerMtok,
    outputUsdMicrosPerMtok: row.outputUsdMicrosPerMtok,
    cacheReadUsdMicrosPerMtok: row.cacheReadUsdMicrosPerMtok,
    cacheWriteUsdMicrosPerMtok: row.cacheWriteUsdMicrosPerMtok,
  };
}

/** USD → VNĐ rate in effect at `at`. The migration seeds one, so missing is a setup error. */
export async function effectiveFxRate(reader: Reader, at: Date): Promise<number> {
  const [row] = await reader
    .select({ value: fxRates.vndPerUsd })
    .from(fxRates)
    .where(sql`${fxRates.effectiveFrom} <= ${at.toISOString()}`)
    .orderBy(desc(fxRates.effectiveFrom), desc(fxRates.createdAt))
    .limit(1);
  if (!row) throw new Error('no exchange rate configured');
  return row.value;
}

/** Default multiplier (‰) in effect at `at`. */
export async function effectiveDefaultMultiplier(reader: Reader, at: Date): Promise<number> {
  const [row] = await reader
    .select({ value: priceMultipliers.permille })
    .from(priceMultipliers)
    .where(sql`${priceMultipliers.effectiveFrom} <= ${at.toISOString()}`)
    .orderBy(desc(priceMultipliers.effectiveFrom), desc(priceMultipliers.createdAt))
    .limit(1);
  if (!row) throw new Error('no default price multiplier configured');
  return row.value;
}

/** A company-specific multiplier wins over the default (spec model-pricing). */
export function resolveMultiplier(companyPermille: number | null, defaultPermille: number): number {
  return companyPermille ?? defaultPermille;
}
