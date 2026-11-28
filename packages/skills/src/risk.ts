import { RISK_LEVELS, type RiskLevel } from '@dw/core/skills';

export { RISK_LEVELS, type RiskLevel };

/**
 * Risk suggestion by simple word rules (design D7, 0.2 #056). Only a suggestion: the author
 * picks, Owner / Admin decides; change 11 replaces it with the scanner.
 */
export const WRITE_WORDS = [
  'gửi cho khách',
  'gửi email',
  'gửi mail',
  'gửi tin',
  'ghi vào',
  'cập nhật sheet',
  'cập nhật bảng',
  'xoá',
  'xóa',
  'chuyển khoản',
  'thanh toán cho',
  'đăng lên',
] as const;

export const READ_WORDS = [
  'google sheets',
  'bảng tính',
  'email',
  'đọc file',
  'tồn kho',
  'bảng giá',
  'tra bảng',
  'tra cứu',
  'số liệu',
] as const;

export function suggestRisk(input: { hasScripts: boolean; body: string }): RiskLevel {
  if (input.hasScripts) return 'high';
  const text = input.body.toLowerCase().normalize('NFC');
  if (WRITE_WORDS.some((word) => text.includes(word))) return 'high';
  if (READ_WORDS.some((word) => text.includes(word))) return 'medium';
  return 'low';
}

/** Script skills are always high (#056, FR-03-06): the api checks this on submit and approve. */
export function riskAllowed(risk: RiskLevel, hasScripts: boolean): boolean {
  return !hasScripts || risk === 'high';
}
