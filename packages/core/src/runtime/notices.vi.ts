/**
 * Fixed replies of the system in web chat and later channels (design D5, D6, D9).
 * They never go through a model and never cost credit. Vietnamese only (CLAUDE.md).
 */
export type NoticeKind =
  | 'worker_suspended'
  | 'worker_offboarded'
  | 'credit_exhausted'
  | 'budget_exhausted'
  | 'no_access'
  | 'max_steps'
  | 'max_seconds'
  | 'max_charge'
  | 'credit_exhausted_midway'
  | 'runner_lost'
  | 'error';

const NOTICES: Readonly<Record<NoticeKind, (workerName: string) => string>> = {
  worker_suspended: (name) => `${name} đang tạm nghỉ, chưa nhận việc mới.`,
  worker_offboarded: (name) => `${name} đã nghỉ việc.`,
  credit_exhausted: () => 'Công ty đã hết credit. Vui lòng báo Owner nạp thêm.',
  budget_exhausted: (name) => `${name} đã dùng hết ngân sách tháng này. Đã báo người quản lý.`,
  no_access: () => 'Bạn không còn quyền giao việc cho nhân viên số này.',
  max_steps: () => 'Việc này cần nhiều bước hơn giới hạn nên đã dừng. Hãy chia nhỏ yêu cầu.',
  max_seconds: () => 'Việc này chạy lâu hơn thời gian cho phép nên đã dừng. Hãy chia nhỏ yêu cầu.',
  max_charge: () =>
    'Việc này tốn nhiều hơn chi phí cho phép của một việc nên đã dừng. Hãy chia nhỏ yêu cầu.',
  credit_exhausted_midway: () =>
    'Công ty đã hết credit nên việc này đã dừng. Vui lòng báo Owner nạp thêm.',
  runner_lost: () => 'Việc bị gián đoạn, vui lòng gửi lại.',
  error: () => 'Có lỗi khi làm việc này. Vui lòng thử lại sau.',
};

export function noticeText(kind: NoticeKind, workerName: string): string {
  return NOTICES[kind](workerName);
}

/** Line appended after a skill file that was cut (0.2 #138). */
export function truncatedFileNote(remainingKb: number): string {
  return `File đã bị cắt, còn ${remainingKb} KB chưa đọc.`;
}

export const TOOL_MESSAGES = {
  noSuchSkill: 'không có kỹ năng này',
  unreadableFile: 'file này chưa đọc được',
  noSuchFile: 'không có file này trong kỹ năng',
  noSuchTool: 'không có công cụ này',
  badInput: 'đầu vào của công cụ không hợp lệ',
} as const;
