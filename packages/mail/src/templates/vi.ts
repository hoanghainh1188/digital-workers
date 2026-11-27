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
