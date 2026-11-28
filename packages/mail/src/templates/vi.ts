/** Vietnamese email templates (0.2 #020). Sending code never builds user-facing text itself. */

export type RenderedEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function verifyEmailTemplate(input: { name: string; url: string }): RenderedEmail {
  const subject = 'Xác minh email của bạn — Digital Workers';
  const text = [
    `Chào ${input.name},`,
    '',
    'Bấm vào link dưới đây để xác minh email cho tài khoản Digital Workers của bạn:',
    input.url,
    '',
    'Link dùng được một lần và hết hạn sau 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua email này.',
  ].join('\n');
  const name = escapeHtml(input.name);
  const url = escapeHtml(input.url);
  const html = `<!doctype html>
<html lang="vi"><body style="font-family:'Be Vietnam Pro',Arial,sans-serif;color:#1f2937;line-height:1.6">
<p>Chào ${name},</p>
<p>Bấm vào nút dưới đây để xác minh email cho tài khoản Digital Workers của bạn:</p>
<p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Xác minh email</a></p>
<p style="font-size:13px;color:#6b7280">Hoặc mở link: ${url}<br>Link dùng được một lần và hết hạn sau 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua email này.</p>
</body></html>`;
  return { subject, text, html };
}

function button(url: string, label: string): string {
  return `<p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${label}</a></p>`;
}

function page(body: string): string {
  return `<!doctype html>
<html lang="vi"><body style="font-family:'Be Vietnam Pro',Arial,sans-serif;color:#1f2937;line-height:1.6">
${body}
</body></html>`;
}

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Trưởng phòng',
  member: 'Nhân viên',
};

/** Invitation to join a company (spec invitations). The link carries the token after `#`. */
export function inviteTemplate(input: {
  companyName: string;
  inviterName: string;
  role: string;
  departmentName: string | null;
  url: string;
}): RenderedEmail {
  const roleName = ROLE_NAMES[input.role] ?? input.role;
  const where = input.departmentName ? `${roleName} — phòng ${input.departmentName}` : roleName;
  const subject = `${input.inviterName} mời bạn tham gia ${input.companyName} — Digital Workers`;
  const text = [
    'Chào bạn,',
    '',
    `${input.inviterName} mời bạn tham gia ${input.companyName} trên Digital Workers với vai trò ${where}.`,
    'Mở link dưới đây để nhận lời mời:',
    input.url,
    '',
    'Lời mời dùng được trong 7 ngày. Nếu bạn không biết người mời, hãy bỏ qua email này.',
  ].join('\n');
  const html = page(`<p>Chào bạn,</p>
<p><b>${escapeHtml(input.inviterName)}</b> mời bạn tham gia <b>${escapeHtml(input.companyName)}</b> trên Digital Workers với vai trò ${escapeHtml(where)}.</p>
${button(escapeHtml(input.url), 'Nhận lời mời')}
<p style="font-size:13px;color:#6b7280">Hoặc mở link: ${escapeHtml(input.url)}<br>Lời mời dùng được trong 7 ngày. Nếu bạn không biết người mời, hãy bỏ qua email này.</p>`);
  return { subject, text, html };
}

/** Password reset link (spec authentication: "Quên mật khẩu"). */
export function resetPasswordTemplate(input: { name: string; url: string }): RenderedEmail {
  const subject = 'Đặt lại mật khẩu — Digital Workers';
  const text = [
    `Chào ${input.name},`,
    '',
    'Bấm vào link dưới đây để đặt mật khẩu mới cho tài khoản Digital Workers của bạn:',
    input.url,
    '',
    'Link dùng được một lần và hết hạn sau 1 giờ. Đặt lại xong, mọi phiên đăng nhập cũ sẽ bị đăng xuất.',
    'Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên.',
  ].join('\n');
  const html = page(`<p>Chào ${escapeHtml(input.name)},</p>
<p>Bấm vào nút dưới đây để đặt mật khẩu mới cho tài khoản Digital Workers của bạn:</p>
${button(escapeHtml(input.url), 'Đặt lại mật khẩu')}
<p style="font-size:13px;color:#6b7280">Hoặc mở link: ${escapeHtml(input.url)}<br>Link dùng được một lần và hết hạn sau 1 giờ. Đặt lại xong, mọi phiên đăng nhập cũ sẽ bị đăng xuất.<br>Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên.</p>`);
  return { subject, text, html };
}

const VND = new Intl.NumberFormat('vi-VN');

/** 1284500 → "1.284.500đ". */
export function formatVnd(amount: number): string {
  return `${VND.format(amount)}đ`;
}

/** "Credit sắp hết" to Owners (spec credit-ledger, 0.2 #071). */
export function lowCreditTemplate(input: {
  name: string;
  companyName: string;
  balanceVnd: number;
  thresholdVnd: number;
  url: string;
}): RenderedEmail {
  const subject = `Credit của ${input.companyName} sắp hết — Digital Workers`;
  const balance = formatVnd(input.balanceVnd);
  const threshold = formatVnd(input.thresholdVnd);
  const text = [
    `Chào ${input.name},`,
    '',
    `Số dư credit của ${input.companyName} còn ${balance}, dưới mức báo ${threshold} (20% lần cộng gần nhất).`,
    'Khi hết credit, nhân viên số sẽ dừng ở bước tiếp theo cho tới khi được cộng thêm.',
    '',
    `Xem số dư: ${input.url}`,
  ].join('\n');
  const html = page(
    [
      `<p>Chào ${escapeHtml(input.name)},</p>`,
      `<p>Số dư credit của <strong>${escapeHtml(input.companyName)}</strong> còn <strong>${balance}</strong>, dưới mức báo ${threshold} (20% lần cộng gần nhất).</p>`,
      '<p>Khi hết credit, nhân viên số sẽ dừng ở bước tiếp theo cho tới khi được cộng thêm.</p>',
      button(escapeHtml(input.url), 'Xem số dư'),
    ].join('\n'),
  );
  return { subject, text, html };
}

/** "Công ty đã hết credit" to Owners, Admins and Trưởng phòng (0.2 #101). */
export function exhaustedCreditTemplate(input: {
  name: string;
  companyName: string;
  url: string;
}): RenderedEmail {
  const subject = `${input.companyName} đã hết credit — Digital Workers`;
  const text = [
    `Chào ${input.name},`,
    '',
    `${input.companyName} đã hết credit. Nhân viên số không gọi được mô hình AI nữa: việc đang làm dở dừng ở bước tiếp theo.`,
    'Owner của công ty liên hệ Digital Workers để được cộng thêm credit.',
    '',
    `Xem chi tiết: ${input.url}`,
  ].join('\n');
  const html = page(
    [
      `<p>Chào ${escapeHtml(input.name)},</p>`,
      `<p><strong>${escapeHtml(input.companyName)}</strong> đã hết credit. Nhân viên số không gọi được mô hình AI nữa: việc đang làm dở dừng ở bước tiếp theo.</p>`,
      '<p>Owner của công ty liên hệ Digital Workers để được cộng thêm credit.</p>',
      button(escapeHtml(input.url), 'Xem chi tiết'),
    ].join('\n'),
  );
  return { subject, text, html };
}

/** "Nhân viên số hết ngân sách tháng" to the worker's manager, once a month (0.2 #129). */
export function workerBudgetExhaustedTemplate(input: {
  name: string;
  workerName: string;
  budgetVnd: number;
  url: string;
}): RenderedEmail {
  const subject = `${input.workerName} đã dùng hết ngân sách tháng này — Digital Workers`;
  const budget = formatVnd(input.budgetVnd);
  const text = [
    `Chào ${input.name},`,
    '',
    `${input.workerName} đã dùng hết ngân sách tháng này (${budget}). Nhân viên số không nhận việc mới cho tới tháng sau, hoặc tới khi ngân sách được tăng.`,
    'Người giao việc đã được báo bằng một câu trả lời cố định, không tốn credit.',
    '',
    `Xem hồ sơ nhân viên số: ${input.url}`,
  ].join('\n');
  const html = page(
    [
      `<p>Chào ${escapeHtml(input.name)},</p>`,
      `<p><strong>${escapeHtml(input.workerName)}</strong> đã dùng hết ngân sách tháng này (<strong>${budget}</strong>). Nhân viên số không nhận việc mới cho tới tháng sau, hoặc tới khi ngân sách được tăng.</p>`,
      '<p>Người giao việc đã được báo bằng một câu trả lời cố định, không tốn credit.</p>',
      button(escapeHtml(input.url), 'Xem hồ sơ'),
    ].join('\n'),
  );
  return { subject, text, html };
}
