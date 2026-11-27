import { describe, expect, it } from 'vitest';
import { createMemoryMailer } from './mailer.ts';
import { verifyEmailTemplate } from './templates/vi.ts';

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
