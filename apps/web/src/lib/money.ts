/**
 * Money formatting and parsing for the Credit and platform pages. Parsing works on
 * the digits of the text, never through floating point (design D3).
 */

const VND = new Intl.NumberFormat('vi-VN');

/** 1284500 → "1.284.500đ"; negative → "−18.420đ" with a real minus sign. */
export function formatVnd(amount: number): string {
  const text = `${VND.format(Math.abs(amount))}đ`;
  return amount < 0 ? `−${text}` : text;
}

/** +1000000 → "+1.000.000đ", −18420 → "−18.420đ". */
export function formatSignedVnd(amount: number): string {
  return amount > 0 ? `+${formatVnd(amount)}` : formatVnd(amount);
}

/** "2.000.000" / "2000000đ" → 2000000; anything that is not digits only → null. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/[.\s,đ]/g, '');
  if (!/^\d{1,12}$/.test(digits)) return null;
  return Number(digits);
}

/** USD text ("3,00", "0.125", "15") → micro-USD integer, max 6 decimals; else null. */
export function parseUsdToMicros(text: string): number | null {
  const match = /^(\d{1,6})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(6, '0');
  return Number(whole) * 1_000_000 + Number(fraction);
}

/** 3000000 → "$3,00"; 125000 → "$0,125" (at least 2 decimals, trailing zeros trimmed). */
export function formatUsdMicros(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  let fraction = String(micros % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `$${VND.format(whole)},${fraction}`;
}

/** 1300 → "1,30"; 1150 → "1,15"; 1125 → "1,125". */
export function formatPermille(permille: number): string {
  const whole = Math.floor(permille / 1000);
  let fraction = String(permille % 1000)
    .padStart(3, '0')
    .replace(/0$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `${whole},${fraction}`;
}

/** "1,15" / "1.3" / "1" → 1150 / 1300 / 1000 (thousandths); else null. */
export function parsePermille(text: string): number | null {
  const match = /^(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}
