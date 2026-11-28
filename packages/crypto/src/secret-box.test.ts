import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox, SecretOpenError } from './secret-box.ts';

const KEY = randomBytes(32);
const SECRET = 'sk-ant-test-0123456789abcdef';
const AAD = 'provider_key:anthropic';

function openError(fn: () => unknown): SecretOpenError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecretOpenError) return error;
    throw error;
  }
  throw new Error('expected SecretOpenError');
}

describe('createSecretBox', () => {
  const box = createSecretBox(KEY);

  it('round-trips a secret', () => {
    const sealed = box.seal(SECRET, AAD);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain(SECRET);
    expect(box.open(sealed, AAD)).toBe(SECRET);
  });

  it('gives a different ciphertext each time (random IV)', () => {
    expect(box.seal(SECRET, AAD)).not.toBe(box.seal(SECRET, AAD));
  });

  it('round-trips unicode and empty strings', () => {
    expect(box.open(box.seal('mật khẩu 🔑', 'x'), 'x')).toBe('mật khẩu 🔑');
    expect(box.open(box.seal('', 'x'), 'x')).toBe('');
  });

  it('rejects a ciphertext moved to another place (different AAD)', () => {
    const sealed = box.seal(SECRET, AAD);
    const error = openError(() => box.open(sealed, 'provider_key:openai'));
    expect(error.message).not.toContain(SECRET);
  });

  it('rejects a ciphertext with one byte changed', () => {
    const [version, iv, body] = box.seal(SECRET, AAD).split('.') as [string, string, string];
    const bytes = Buffer.from(body, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    openError(() => box.open(`${version}.${iv}.${bytes.toString('base64url')}`, AAD));
  });

  it('rejects an unknown version and malformed input', () => {
    const sealed = box.seal(SECRET, AAD);
    openError(() => box.open(sealed.replace(/^v1/, 'v2'), AAD));
    openError(() => box.open('garbage', AAD));
    openError(() => box.open(`${sealed}.extra`, AAD));
    openError(() => box.open('v1..', AAD));
  });

  it('rejects a ciphertext sealed with another key', () => {
    const other = createSecretBox(randomBytes(32));
    const error = openError(() => box.open(other.seal(SECRET, AAD), AAD));
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String(error.stack)).not.toContain(SECRET);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createSecretBox(randomBytes(16))).toThrow(/32 bytes/);
  });
});
