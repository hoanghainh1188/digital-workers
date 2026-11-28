/**
 * Vietnamese strings for the company Credit page and the "hết credit" banner
 * (change add-llm-gateway-and-credit, docs/design/screens/credit.html). Merged into `vi`.
 */
export const creditVi = {
  'shell.nav.credit': 'Credit',

  'creditBanner.title': 'Công ty đã hết credit.',
  'creditBanner.body':
    'Nhân viên số đã ngừng nhận việc mới. Việc đang làm dở dừng ở bước tiếp theo. Người nhắn bot sẽ nhận câu trả lời "công ty đã hết credit".',
  'creditBanner.link': 'Xem credit',

  'credit.eyebrow': 'Công ty',
  'credit.title': 'Credit',
  'credit.lead':
    'Nhân viên số dùng credit mỗi lần làm việc. 1 credit = 1 đồng; giá đã gồm phí dịch vụ.',
  'credit.overview': 'Tổng quan credit',
  'credit.balance': 'Số dư hiện tại',
  'credit.pill.low': 'Dưới 20% lần nạp gần nhất',
  'credit.pill.exhausted': 'Hết credit',
  'credit.pill.trial': 'Credit dùng thử',
  'credit.runway': 'Đủ dùng khoảng {days} ngày nếu dùng như 7 ngày qua.',
  'credit.runway.none': 'Chưa có mức dùng 7 ngày qua để ước tính.',
  'credit.runway.exhausted':
    'Được cộng thêm là nhân viên số nhận việc lại ngay, không cần bật lại từng người.',
  'credit.runway.unverified':
    'Xác minh email để nhận 200.000đ credit dùng thử. Mỗi công ty nhận một lần.',
  'credit.runway.new':
    'Credit dùng thử, tặng khi bạn xác minh email. Đủ để thử 1–2 nhân viên số trong vài ngày.',
  'credit.topup': 'Nạp credit',
  'credit.soon': 'Sắp có',
  'credit.help.owner': 'Trong thời gian dùng thử, nhắn đội hỗ trợ để được cộng credit.',
  'credit.help.ownerLow': 'Nhắn đội hỗ trợ để được cộng credit.',
  'credit.help.admin': 'Admin xem được số dư và lịch sử. Owner nạp credit.',
  'credit.help.adminLow': 'Báo Owner nạp thêm credit.',
  'credit.help.unverifiedAdmin': 'Owner cần xác minh email để công ty nhận credit dùng thử.',
  'credit.month.title': 'Đã dùng tháng {month}',
  'credit.month.calls': '{count} lần làm việc',
  'credit.month.workers':
    'Mức dùng của từng nhân viên số so với ngân sách tháng hiện trong bảng lương.',
  'credit.start.title': 'Bắt đầu thế nào?',
  'credit.start.body':
    'Credit trừ dần mỗi khi nhân viên số trả lời hoặc làm việc. Mỗi nhân viên số có ngân sách tháng riêng, nên không ai tiêu quá phần được giao.',
  'credit.start.cta': 'Tuyển nhân viên số đầu tiên',
  'credit.threshold':
    'Báo Owner qua email khi số dư dưới 20% lần nạp gần nhất (hiện là {threshold}). Hết credit thì báo cả Owner, Admin và Trưởng phòng.',
  'credit.history.title': 'Lịch sử credit',
  'credit.history.month': 'Tháng',
  'credit.history.monthOption': 'Tháng {month}',
  'credit.history.type': 'Loại',
  'credit.history.type.all': 'Mọi loại',
  'credit.history.type.credit': 'Cộng / trừ tay',
  'credit.history.type.usage': 'Trừ theo việc',
  'credit.history.statement': 'Tải sao kê',
  'credit.history.col.tx': 'Giao dịch',
  'credit.history.col.amount': 'Số tiền',
  'credit.history.col.after': 'Số dư sau',
  'credit.history.today': 'Hôm nay · {date}',
  'credit.history.calls': '{count} lần làm việc',
  'credit.history.expand': 'Xem chi tiết',
  'credit.history.collapse': 'Ẩn chi tiết',
  'credit.history.call': '{time} · {tokens} token',
  'credit.history.loadingCalls': 'Đang tải từng lần…',
  'credit.history.noWorker': 'Nhân viên số',
  'credit.history.empty.title': 'Chưa có giao dịch nào trong tháng này',
  'credit.history.empty.body': 'Mỗi ngày, chi phí của từng nhân viên số gộp thành một dòng ở đây.',
  'credit.kind.trial': 'Credit dùng thử',
  'credit.kind.trialNote': 'Tặng khi Owner xác minh email',
  'credit.kind.credit': 'Cộng credit',
  'credit.kind.debit': 'Trừ credit',
  'credit.reason.bank_transfer': 'Đã nhận chuyển khoản',
  'credit.reason.trial': 'Credit dùng thử',
  'credit.reason.system_fix': 'Bù lỗi hệ thống',
  'credit.reason.other': 'Khác',
} as const;
