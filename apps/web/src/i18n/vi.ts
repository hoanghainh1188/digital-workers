/** Vietnamese UI strings (0.2 #020). Components read these through `t()` only. */
export const vi = {
  'app.name': 'Digital Workers',
  'app.tagline': 'Nhân viên số cho doanh nghiệp Việt',
  'home.eyebrow': 'Đang xây dựng',
  'home.title': 'Tuyển, giao việc và quản lý nhân viên số như một đội ngũ thật',
  'home.lead':
    'Nhân viên số nhận việc qua Telegram, Zalo và web chat. Bạn duyệt việc rủi ro, đặt ngân sách và xem bảng lương ở đây.',
  'home.status.title': 'Khung hệ thống đã sẵn sàng',
  'home.status.body': 'Màn hình đăng ký, phòng ban và người dùng sẽ có ở bước tiếp theo.',
  'home.cta.signin': 'Đăng nhập (sắp có)',
  'home.steps.hire': 'Tuyển',
  'home.steps.train': 'Thử việc',
  'home.steps.work': 'Chính thức',
} as const;

export type MessageKey = keyof typeof vi;
