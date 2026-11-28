import { describe, expect, it } from 'vitest';
import {
  formatPermille,
  formatSignedVnd,
  formatUsdMicros,
  formatVnd,
  parsePermille,
  parseUsdToMicros,
  parseVnd,
} from './money.ts';

describe('money formatting', () => {
  it('formats đồng with Vietnamese grouping and a real minus sign', () => {
    expect(formatVnd(1_284_500)).toBe('1.284.500đ');
    expect(formatVnd(0)).toBe('0đ');
    expect(formatVnd(-18_420)).toBe('−18.420đ');
    expect(formatSignedVnd(1_000_000)).toBe('+1.000.000đ');
    expect(formatSignedVnd(-150)).toBe('−150đ');
  });

  it('parses typed đồng amounts', () => {
    expect(parseVnd('2.000.000')).toBe(2_000_000);
    expect(parseVnd('2000000đ')).toBe(2_000_000);
    expect(parseVnd('')).toBeNull();
    expect(parseVnd('1,5k')).toBeNull();
  });

  it('turns USD text into micro-USD without floating point', () => {
    expect(parseUsdToMicros('3,00')).toBe(3_000_000);
    expect(parseUsdToMicros('0.125')).toBe(125_000);
    expect(parseUsdToMicros('15')).toBe(15_000_000);
    expect(parseUsdToMicros('0,1')).toBe(100_000);
    // 0.1 + 0.2 style errors cannot happen: digits are concatenated, not multiplied.
    expect(parseUsdToMicros('0,000001')).toBe(1);
    expect(parseUsdToMicros('1,0000001')).toBeNull();
    expect(parseUsdToMicros('-1')).toBeNull();
    expect(parseUsdToMicros('abc')).toBeNull();
  });

  it('formats micro-USD and multipliers like the design', () => {
    expect(formatUsdMicros(3_000_000)).toBe('$3,00');
    expect(formatUsdMicros(125_000)).toBe('$0,125');
    expect(formatUsdMicros(15_000_000)).toBe('$15,00');
    expect(formatPermille(1300)).toBe('1,30');
    expect(formatPermille(1150)).toBe('1,15');
    expect(formatPermille(1125)).toBe('1,125');
    expect(parsePermille('1,15')).toBe(1150);
    expect(parsePermille('1.3')).toBe(1300);
    expect(parsePermille('1')).toBe(1000);
    expect(parsePermille('x')).toBeNull();
  });
});
