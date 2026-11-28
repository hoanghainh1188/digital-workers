import { describe, expect, it } from 'vitest';
import { riskAllowed, suggestRisk } from './risk.ts';

describe('suggestRisk (design D7)', () => {
  it.each([
    [true, 'Chỉ soạn văn bản.', 'high'],
    [false, 'Soạn báo giá rồi gửi email cho khách.', 'high'],
    [false, 'Đọc Google Sheets để lấy số liệu.', 'medium'],
    [false, 'Soạn biên bản họp từ ghi chú. Kiểm tra lại chính tả.', 'low'],
  ] as const)('scripts=%s %j → %s', (hasScripts, body, expected) => {
    expect(suggestRisk({ hasScripts, body })).toBe(expected);
  });

  it('script skills can only be high', () => {
    expect(riskAllowed('medium', true)).toBe(false);
    expect(riskAllowed('high', true)).toBe(true);
    expect(riskAllowed('low', false)).toBe(true);
  });
});
