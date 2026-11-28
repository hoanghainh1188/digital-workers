import { describe, expect, it } from 'vitest';
import { createMemoryMailer } from './mailer.ts';
import { inviteTemplate, resetPasswordTemplate, verifyEmailTemplate } from './templates/vi.ts';

describe('verifyEmailTemplate', () => {
  const email = verifyEmailTemplate({
    name: 'An <script>',
    url: 'https://app.example.vn/verify-email?token=abc&x=1',
  });

  it('is Vietnamese and carries the link in text and html', () => {
    expect(email.subject).toContain('Xác minh email');
    expect(email.text).toContain('https://app.example.vn/verify-email?token=abc&x=1');
    expect(email.html).toContain('href="https://app.example.vn/verify-email?token=abc&amp;x=1"');
  });

  it('escapes the user name in html', () => {
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('An &lt;script&gt;');
  });
});

describe('createMemoryMailer', () => {
  it('records sent emails with the sender', async () => {
    const { mailer, sent } = createMemoryMailer('noreply@dw.test');
    await mailer.send({ to: 'an@example.com', subject: 's', text: 't', html: '<p>t</p>' });
    expect(sent).toEqual([
      { from: 'noreply@dw.test', to: 'an@example.com', subject: 's', text: 't', html: '<p>t</p>' },
    ]);
  });
});

describe('inviteTemplate', () => {
  const email = inviteTemplate({
    companyName: 'Gốm <An> Phú',
    inviterName: 'Trần "Đức"',
    role: 'manager',
    departmentName: 'Kinh doanh & Bán lẻ',
    url: 'https://app.example.vn/invite#token=abc&x',
  });

  it('names the company, inviter, role and department and carries the link', () => {
    expect(email.subject).toContain('Gốm <An> Phú');
    expect(email.text).toContain('Trưởng phòng — phòng Kinh doanh & Bán lẻ');
    expect(email.text).toContain('https://app.example.vn/invite#token=abc&x');
    expect(email.html).toContain('href="https://app.example.vn/invite#token=abc&amp;x"');
  });

  it('escapes every user-supplied value in html', () => {
    expect(email.html).not.toMatch(/<An>|"Đức"|& Bán/);
    expect(email.html).toContain('Gốm &lt;An&gt; Phú');
    expect(email.html).toContain('Trần &quot;Đức&quot;');
  });
});

describe('resetPasswordTemplate', () => {
  const email = resetPasswordTemplate({ name: 'An <b>', url: 'https://app.example.vn/r?t=1&y=2' });

  it('carries the link and says it lasts 1 hour', () => {
    expect(email.subject).toContain('Đặt lại mật khẩu');
    expect(email.text).toContain('https://app.example.vn/r?t=1&y=2');
    expect(email.text).toContain('1 giờ');
    expect(email.html).toContain('href="https://app.example.vn/r?t=1&amp;y=2"');
  });

  it('escapes the name', () => {
    expect(email.html).toContain('An &lt;b&gt;');
  });
});
