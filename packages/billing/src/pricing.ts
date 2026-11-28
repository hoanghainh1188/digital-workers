/**
 * Exact integer pricing (design D3, spec model-pricing). No floating point anywhere:
 * every step is BigInt and the result is rounded half-up exactly once.
 *
 *   T       = Σ tokens_i × price_i                  (price in µUSD per 1M tokens)
 *   real µđ = round(T × vndPerUsd / 10⁶)
 *   sale µđ = round(T × vndPerUsd × permille / 10⁹)
 */

export const MICRO = 1_000_000n;
const BILLION = 1_000_000_000n;

export type TokenUsage = {
  /** Input tokens billed at the input price (excludes cache reads and writes). */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

/** Prices in micro-USD per 1 million tokens. */
export type ModelPrice = {
  readonly inputUsdMicrosPerMtok: number;
  readonly outputUsdMicrosPerMtok: number;
  readonly cacheReadUsdMicrosPerMtok: number;
  /** null: the provider does not price cache writes separately; they cost the input price. */
  readonly cacheWriteUsdMicrosPerMtok: number | null;
};

export type Cost = {
  /** What the provider charges us, in micro-VNĐ. */
  readonly realMicroVnd: bigint;
  /** What the company pays (real × multiplier), in micro-VNĐ. */
  readonly chargeMicroVnd: bigint;
};

function nonNegativeInt(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return BigInt(value);
}

/** round(n / d) with halves going up, for n ≥ 0, d > 0. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** Cost of one model call. */
export function computeCost(
  usage: TokenUsage,
  price: ModelPrice,
  vndPerUsd: number,
  multiplierPermille: number,
): Cost {
  const rate = nonNegativeInt(vndPerUsd, 'vndPerUsd');
  const permille = nonNegativeInt(multiplierPermille, 'multiplierPermille');
  if (rate === 0n) throw new RangeError('vndPerUsd must be positive');
  if (permille < 1000n) throw new RangeError('multiplier must be at least 1');

  const cacheWritePrice = price.cacheWriteUsdMicrosPerMtok ?? price.inputUsdMicrosPerMtok;
  const total =
    nonNegativeInt(usage.inputTokens, 'inputTokens') *
      nonNegativeInt(price.inputUsdMicrosPerMtok, 'inputPrice') +
    nonNegativeInt(usage.outputTokens, 'outputTokens') *
      nonNegativeInt(price.outputUsdMicrosPerMtok, 'outputPrice') +
    nonNegativeInt(usage.cacheReadTokens, 'cacheReadTokens') *
      nonNegativeInt(price.cacheReadUsdMicrosPerMtok, 'cacheReadPrice') +
    nonNegativeInt(usage.cacheWriteTokens, 'cacheWriteTokens') *
      nonNegativeInt(cacheWritePrice, 'cacheWritePrice');

  return {
    realMicroVnd: divRoundHalfUp(total * rate, MICRO),
    chargeMicroVnd: divRoundHalfUp(total * rate * permille, BILLION),
  };
}

export type CarryResult = {
  /** Whole đồng to debit now. */
  readonly debitVnd: number;
  /** Fraction (micro-VNĐ, 0 ≤ x < 10⁶) carried to the next charge. */
  readonly carryMicroVnd: number;
};

/**
 * Floor + carry (design D3): debits whole đồng and keeps the fraction, so over any
 * sequence Σ debit = floor(Σ charge) — never more than the company owes.
 */
export function applyCarry(carryMicroVnd: number, chargeMicroVnd: bigint): CarryResult {
  const carry = nonNegativeInt(carryMicroVnd, 'carryMicroVnd');
  if (carry >= MICRO) throw new RangeError('carry must be below one đồng');
  if (chargeMicroVnd < 0n) throw new RangeError('charge must be non-negative');
  const total = carry + chargeMicroVnd;
  return { debitVnd: Number(total / MICRO), carryMicroVnd: Number(total % MICRO) };
}

/** Whole đồng from micro-VNĐ, rounded down (worker month spend, design D7). */
export function floorVnd(microVnd: bigint): number {
  return Number(microVnd / MICRO);
}
