import { describe, expect, it } from 'vitest';
import { applyCarry, computeCost, divRoundHalfUp, floorVnd, type ModelPrice } from './pricing.ts';

const sonnet: ModelPrice = {
  inputUsdMicrosPerMtok: 3_000_000,
  outputUsdMicrosPerMtok: 15_000_000,
  cacheReadUsdMicrosPerMtok: 300_000,
  cacheWriteUsdMicrosPerMtok: 3_750_000,
};
const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('computeCost (spec model-pricing)', () => {
  it('one call: 1.000 in + 500 out → 266,7đ real, 346,71đ sale', () => {
    expect(
      computeCost({ ...none, inputTokens: 1000, outputTokens: 500 }, sonnet, 25400, 1300),
    ).toEqual({
      realMicroVnd: 266_700_000n,
      chargeMicroVnd: 346_710_000n,
    });
  });

  it('cache reads: 10.000 tokens at $0,30 → 76,2đ real, 99,06đ sale', () => {
    expect(computeCost({ ...none, cacheReadTokens: 10_000 }, sonnet, 25400, 1300)).toEqual({
      realMicroVnd: 76_200_000n,
      chargeMicroVnd: 99_060_000n,
    });
  });

  it('cache writes use their own price, or the input price when it is null', () => {
    const write = { ...none, cacheWriteTokens: 1000 };
    expect(computeCost(write, sonnet, 25400, 1000).realMicroVnd).toBe(95_250_000n);
    const noWritePrice = { ...sonnet, cacheWriteUsdMicrosPerMtok: null };
    expect(computeCost(write, noWritePrice, 25400, 1000).realMicroVnd).toBe(76_200_000n);
  });

  it('rounds half up exactly once', () => {
    // 1 token × $1/M × 1đ = 1µđ real; × 1,5 = 1,5µđ → 2µđ.
    const tiny: ModelPrice = { ...sonnet, inputUsdMicrosPerMtok: 1_000_000 };
    expect(computeCost({ ...none, inputTokens: 1 }, tiny, 1, 1500)).toEqual({
      realMicroVnd: 1n,
      chargeMicroVnd: 2n,
    });
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
  });

  it('stays exact for very large token counts (beyond Number precision)', () => {
    const opus: ModelPrice = { ...sonnet, outputUsdMicrosPerMtok: 75_000_000 };
    const cost = computeCost({ ...none, outputTokens: 1_000_000_000 }, opus, 30_000, 3000);
    // 10⁹ × 75·10⁶ = 7,5·10¹⁶ µUSD·tok; × 30.000 / 10⁶ = 2,25·10¹⁵ µđ.
    expect(cost.realMicroVnd).toBe(2_250_000_000_000_000n);
    expect(cost.chargeMicroVnd).toBe(6_750_000_000_000_000n);
  });

  it('rejects fractional or negative inputs and multipliers below 1', () => {
    expect(() => computeCost({ ...none, inputTokens: 1.5 }, sonnet, 25400, 1300)).toThrow(
      RangeError,
    );
    expect(() => computeCost({ ...none, inputTokens: -1 }, sonnet, 25400, 1300)).toThrow(
      RangeError,
    );
    expect(() => computeCost(none, sonnet, 25400, 999)).toThrow(RangeError);
    expect(() => computeCost(none, sonnet, 0, 1300)).toThrow(RangeError);
  });
});

describe('applyCarry (spec model-pricing "Cộng dồn phần lẻ")', () => {
  it('two calls of 346,71đ debit 346đ then 347đ, leaving 0,42đ', () => {
    const first = applyCarry(0, 346_710_000n);
    expect(first).toEqual({ debitVnd: 346, carryMicroVnd: 710_000 });
    const second = applyCarry(first.carryMicroVnd, 346_710_000n);
    expect(second).toEqual({ debitVnd: 347, carryMicroVnd: 420_000 });
  });

  it('a 0,40đ call debits 0đ and carries 0,40đ', () => {
    expect(applyCarry(0, 400_000n)).toEqual({ debitVnd: 0, carryMicroVnd: 400_000 });
  });

  it('Σ debit = floor(Σ charge) for 1.000 random charges', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    let carry = 0;
    let debited = 0n;
    let charged = 0n;
    for (let i = 0; i < 1000; i += 1) {
      const charge = BigInt(random()) * 37n;
      charged += charge;
      const result = applyCarry(carry, charge);
      debited += BigInt(result.debitVnd);
      carry = result.carryMicroVnd;
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(carry).toBeLessThan(1_000_000);
    }
    expect(debited).toBe(charged / 1_000_000n);
  });

  it('refuses a carry of a whole đồng or more', () => {
    expect(() => applyCarry(1_000_000, 0n)).toThrow(RangeError);
  });
});

describe('floorVnd', () => {
  it('rounds down to whole đồng', () => {
    expect(floorVnd(268_900_999_999n)).toBe(268_900);
  });
});
