import { PROVIDERS, type Provider } from '@dw/billing';
import { type SecretBox, SecretOpenError } from '@dw/crypto';
import { type Database, providerKeys } from '@dw/db';
import { eq, sql } from '@dw/db/drizzle';
import { ProviderNotConfiguredError } from './errors.ts';

/** AAD binding a sealed key to its row (spec secret-encryption "Bản mã bị chép"). */
export function providerKeyAad(provider: Provider): string {
  return `provider_key:${provider}`;
}

export type ProviderKeyStatus = {
  readonly provider: Provider;
  readonly configured: boolean;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  readonly lastOkAt: Date | null;
};

export type ProviderKeyStore = {
  /** The decrypted key, cached for `ttlMs`. Throws ProviderNotConfiguredError. */
  readonly get: (provider: Provider) => Promise<string>;
  /**
   * Seals and stores `apiKey` (replacing the old one) and drops the cache. `onWritten`
   * runs in the same transaction (the platform audit event).
   */
  readonly save: (
    provider: Provider,
    apiKey: string,
    updatedBy: string,
    onWritten?: (tx: KeyTx) => Promise<void>,
  ) => Promise<void>;
  /** "Đã cấu hình" status only: never the key or the ciphertext. */
  readonly status: () => Promise<ProviderKeyStatus[]>;
  readonly invalidate: (provider?: Provider) => void;
};

type KeyTx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type ProviderKeyStoreOptions = {
  readonly database: Pick<Database, 'db'>;
  readonly box: SecretBox;
  /** How long a decrypted key stays in memory (design D6: 60 s). */
  readonly ttlMs?: number;
  readonly now?: () => number;
};

export function createProviderKeyStore(options: ProviderKeyStoreOptions): ProviderKeyStore {
  const { database, box } = options;
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<Provider, { key: string; expiresAt: number }>();

  return Object.freeze({
    async get(provider: Provider): Promise<string> {
      const cached = cache.get(provider);
      if (cached && cached.expiresAt > now()) return cached.key;
      const [row] = await database.db
        .select({ sealed: providerKeys.sealed })
        .from(providerKeys)
        .where(eq(providerKeys.provider, provider));
      if (!row) throw new ProviderNotConfiguredError(provider);
      let key: string;
      try {
        key = box.open(row.sealed, providerKeyAad(provider));
      } catch (error) {
        if (error instanceof SecretOpenError) throw new ProviderNotConfiguredError(provider);
        throw error;
      }
      cache.set(provider, { key, expiresAt: now() + ttlMs });
      return key;
    },

    async save(provider, apiKey, updatedBy, onWritten): Promise<void> {
      const sealed = box.seal(apiKey, providerKeyAad(provider));
      await database.db.transaction(async (tx) => {
        await tx
          .insert(providerKeys)
          .values({ provider, sealed, updatedBy, updatedAt: new Date(), lastOkAt: new Date() })
          .onConflictDoUpdate({
            target: providerKeys.provider,
            set: { sealed, updatedBy, updatedAt: sql`now()`, lastOkAt: sql`now()` },
          });
        await onWritten?.(tx);
      });
      cache.delete(provider);
    },

    async status(): Promise<ProviderKeyStatus[]> {
      const rows = await database.db
        .select({
          provider: providerKeys.provider,
          updatedAt: providerKeys.updatedAt,
          updatedBy: providerKeys.updatedBy,
          lastOkAt: providerKeys.lastOkAt,
        })
        .from(providerKeys);
      return PROVIDERS.map((provider) => {
        const row = rows.find((item) => item.provider === provider);
        return {
          provider,
          configured: Boolean(row),
          updatedAt: row?.updatedAt ?? null,
          updatedBy: row?.updatedBy ?? null,
          lastOkAt: row?.lastOkAt ?? null,
        };
      });
    },

    invalidate(provider?: Provider): void {
      if (provider) cache.delete(provider);
      else cache.clear();
    },
  });
}
