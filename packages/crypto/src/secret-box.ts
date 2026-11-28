import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/** Decryption failed. Never carries the ciphertext, the plaintext or the key. */
export class SecretOpenError extends Error {
  constructor() {
    super('Secret could not be decrypted');
    this.name = 'SecretOpenError';
  }
}

export type SecretBox = {
  /** Encrypts `plaintext`, bound to `aad` (the place it is stored, e.g. `provider_key:anthropic`). */
  readonly seal: (plaintext: string, aad: string) => string;
  /** Decrypts a value from `seal` with the same `aad`; throws SecretOpenError otherwise. */
  readonly open: (sealed: string, aad: string) => string;
};

/**
 * AES-256-GCM secret box (design D2). Stored format: `v1.<iv>.<ciphertext+tag>`,
 * both parts base64url. The version prefix leaves room for key rotation later.
 */
export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error('encryption key must be 32 bytes');
  const masterKey = Buffer.from(key);

  return Object.freeze({
    seal(plaintext: string, aad: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const sealed = Buffer.concat([body, cipher.getAuthTag()]);
      return `${VERSION}.${iv.toString('base64url')}.${sealed.toString('base64url')}`;
    },

    open(sealed: string, aad: string): string {
      const [version, ivText, bodyText, extra] = sealed.split('.');
      if (version !== VERSION || !ivText || !bodyText || extra !== undefined) {
        throw new SecretOpenError();
      }
      const iv = Buffer.from(ivText, 'base64url');
      const body = Buffer.from(bodyText, 'base64url');
      if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new SecretOpenError();
      try {
        const decipher = createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
        const plain = Buffer.concat([
          decipher.update(body.subarray(0, body.length - TAG_BYTES)),
          decipher.final(),
        ]);
        return plain.toString('utf8');
      } catch {
        throw new SecretOpenError();
      }
    },
  });
}
