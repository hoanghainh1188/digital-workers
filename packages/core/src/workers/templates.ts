import type { VoicePreset } from './schemas.ts';

/**
 * Built-in worker templates (FR-02-07, design D6). Constants, not a table: `id` is stored
 * in `workers.template_id` and audit events. The job description and voice are sample
 * Vietnamese data copied into a new profile (0.2 #020); card labels live in the web i18n.
 */
export interface WorkerTemplate {
  readonly id: string;
  readonly suggestedName: string;
  readonly jobDescription: string;
  readonly voicePreset: VoicePreset;
}

export const WORKER_TEMPLATES: readonly WorkerTemplate[] = [
  {
    id: 'quote-assistant',
    suggestedName: 'Trợ lý báo giá',
    voicePreset: 'polite',
    jobDescription: [
      'Nhận yêu cầu báo giá từ nhân viên kinh doanh hoặc khách hàng được chuyển tới.',
      'Tra bảng giá đại lý mới nhất được giao, tính đúng số lượng, đơn giá và chiết khấu theo bảng.',
      'Lập báo giá nháp theo mẫu của công ty, ghi rõ hiệu lực báo giá và điều kiện giao hàng.',
      'Gửi bản nháp cho người phụ trách duyệt trước khi gửi khách; không tự gửi thẳng cho khách.',
      'Không tự hứa chiết khấu, quà tặng hay thời gian giao hàng ngoài bảng giá và chính sách.',
      'Thiếu thông tin (mã hàng, số lượng, địa chỉ giao) thì hỏi lại ngắn gọn, không đoán.',
    ].join(' '),
  },
  {
    id: 'internal-support',
    suggestedName: 'Trợ lý CSKH nội bộ',
    voicePreset: 'friendly',
    jobDescription: [
      'Trả lời câu hỏi của nhân viên về chính sách đổi trả, bảo hành, quy trình nội bộ và thông tin sản phẩm.',
      'Chỉ dựa trên tài liệu được giao; trích tên tài liệu khi trả lời để người hỏi kiểm tra lại được.',
      'Không chắc hoặc tài liệu không nói tới thì nói rõ là chưa có thông tin và chỉ người phụ trách.',
      'Không tự đặt ra ngoại lệ cho chính sách, không hứa thay công ty.',
      'Câu hỏi lặp lại nhiều lần thì ghi chú lại để người quản lý bổ sung tài liệu.',
    ].join(' '),
  },
  {
    id: 'report-digest',
    suggestedName: 'Trợ lý tổng hợp báo cáo',
    voicePreset: 'formal',
    jobDescription: [
      'Gom số liệu từ các bảng tính được giao vào cuối ngày hoặc cuối tuần.',
      'Viết báo cáo ngắn gọn: các số chính, thay đổi so với kỳ trước, và điểm bất thường cần xem.',
      'Ghi rõ nguồn và thời điểm lấy số liệu; ô trống hoặc số liệu lạ thì nêu ra, không tự sửa.',
      'Không thay đổi dữ liệu trong bảng tính gốc.',
      'Gửi báo cáo cho người quản lý và những người được chỉ định.',
    ].join(' '),
  },
];

export function findWorkerTemplate(id: string): WorkerTemplate | undefined {
  return WORKER_TEMPLATES.find((template) => template.id === id);
}
