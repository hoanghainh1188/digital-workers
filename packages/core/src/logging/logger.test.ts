import { describe, expect, it } from 'vitest';
import { serializeRequest } from './logger.ts';

describe('serializeRequest', () => {
  it('drops the query string', () => {
    expect(
      serializeRequest({ method: 'GET', url: '/api/auth/verify-email?token=abc', id: 1 }),
    ).toEqual({
      method: 'GET',
      url: '/api/auth/verify-email',
      reqId: 1,
    });
  });

  it('redacts the password-reset token carried in the path', () => {
    const logged = serializeRequest({
      method: 'GET',
      url: '/api/auth/reset-password/s3cr3tT0ken?callbackURL=http%3A%2F%2Fx',
    });
    expect(logged.url).toBe('/api/auth/reset-password/[redacted]');
    expect(JSON.stringify(logged)).not.toContain('s3cr3tT0ken');
  });

  it('leaves the reset POST endpoint alone', () => {
    expect(serializeRequest({ method: 'POST', url: '/api/auth/reset-password' }).url).toBe(
      '/api/auth/reset-password',
    );
  });
});
