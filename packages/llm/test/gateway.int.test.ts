import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { adjustCredit, ensureCreditAccount, type Notifier, readBalance } from '@dw/billing';
import { createLogger } from '@dw/core';
import { createSecretBox } from '@dw/crypto';
import {
  companies,
  costEntries,
  createDatabase,
  type Database,
  members,
  modelPrices,
  providerKeys,
  withCompany,
} from '@dw/db';
import { eq } from '@dw/db/drizzle';
import { startTestPostgres, type TestPostgres } from '@dw/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreditExhaustedError,
  createGateway,
  createProviderKeyStore,
  ModelNotPricedError,
  NoCompanyError,
  ProviderCallError,
  ProviderNotConfiguredError,
  UsageNotRecordedError,
} from '../src/index.ts';
import { createFakeModels, type FakeModels } from '../src/testing.ts';

const ANTHROPIC_KEY = 'sk-ant-test-SECRET-1111';
const OPENAI_KEY = 'sk-test-SECRET-2222';

let pg: TestPostgres;
let app: Database;
const box = createSecretBox(randomBytes(32));
let fake: FakeModels;
let lines: string[];

function captureLogger() {
  lines = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return createLogger('debug', stream);
}

function gatewayWith(overrides: { notifier?: Notifier } = {}) {
  const keys = createProviderKeyStore({ database: app, box });
  return {
    keys,
    gateway: createGateway({
      database: app,
      keys,
      models: fake,
      logger: captureLogger(),
      maxRetries: 0,
      ...overrides,
    }),
  };
}

async function seedCompany(label: string, balance: number): Promise<string> {
  const userId = randomUUID();
  await app.pool.query('insert into auth.users (id, name, email) values ($1, $2, $3)', [
    userId,
    label,
    `${label}-${userId}@example.com`,
  ]);
  const companyId = randomUUID();
  await withCompany(app, companyId, async (tx) => {
    await tx.insert(companies).values({ id: companyId, name: label });
    await tx.insert(members).values({ companyId, userId, role: 'owner' });
    await ensureCreditAccount(tx, companyId);
  });
  if (balance > 0) {
    await adjustCredit(app, {
      companyId,
      direction: 'credit',
      amountVnd: balance,
      reason: 'other',
      note: 'test',
      actorAdminId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
  }
  return companyId;
}

async function costsOf(companyId: string) {
  return withCompany(app, companyId, (tx) => tx.select().from(costEntries));
}

const hello = [{ role: 'user' as const, content: 'Chào' }];
const sonnet = { provider: 'anthropic' as const, id: 'claude-sonnet-5-5' };
const gpt = { provider: 'openai' as const, id: 'gpt-5.5-mini' };

beforeAll(async () => {
  pg = await startTestPostgres();
  app = createDatabase(pg.appUrl, { max: 5 });
  const past = new Date('2026-01-01T00:00:00Z');
  await app.db.insert(modelPrices).values([
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputUsdMicrosPerMtok: 3_000_000,
      outputUsdMicrosPerMtok: 15_000_000,
      cacheReadUsdMicrosPerMtok: 300_000,
      cacheWriteUsdMicrosPerMtok: 3_750_000,
      effectiveFrom: past,
    },
    {
      provider: 'openai',
      model: 'gpt-5.5-mini',
      inputUsdMicrosPerMtok: 500_000,
      outputUsdMicrosPerMtok: 2_000_000,
      cacheReadUsdMicrosPerMtok: 50_000,
      effectiveFrom: past,
    },
  ]);
  const { keys } = gatewayWith();
  await keys.save('anthropic', ANTHROPIC_KEY, randomUUID());
  await keys.save('openai', OPENAI_KEY, randomUUID());
});

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

beforeEach(() => {
  fake = createFakeModels();
  // Spec "Mô hình giả cho test": any real network request fails the test.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network is disabled in tests')));
  return () => vi.unstubAllGlobals();
});

describe('gateway.generate (task 5.4)', () => {
  it('charges tokens × price × rate × multiplier: one CostEntry, one debit', async () => {
    const companyId = await seedCompany('ok', 100_000);
    const { gateway } = gatewayWith();
    const result = await gateway.generate({
      companyId,
      model: sonnet,
      messages: hello,
      maxOutputTokens: 1000,
    });
    expect(result).toMatchObject({
      text: 'Xin chào',
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      chargeVnd: 346,
    });
    const [entry] = await costsOf(companyId);
    expect(entry).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 1000,
      outputTokens: 500,
      vndPerUsd: 25_400,
      multiplierPermille: 1300,
      realCostMicroVnd: 266_700_000n,
      chargeMicroVnd: 346_710_000n,
    });
    expect(await readBalance(app, companyId)).toBe(100_000 - 346);
    expect(fake.calls).toEqual([
      { provider: 'anthropic', modelId: 'claude-sonnet-5-5', apiKey: ANTHROPIC_KEY },
    ]);
  });

  it('same call shape for both providers, each CostEntry names its provider and model', async () => {
    const companyId = await seedCompany('two', 100_000);
    const { gateway } = gatewayWith();
    const a = await gateway.generate({
      companyId,
      model: sonnet,
      messages: hello,
      maxOutputTokens: 10,
    });
    const b = await gateway.generate({
      companyId,
      model: gpt,
      messages: hello,
      maxOutputTokens: 10,
    });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    const entries = await costsOf(companyId);
    expect(entries.map((entry) => `${entry.provider}/${entry.model}`).sort()).toEqual([
      'anthropic/claude-sonnet-5-5',
      'openai/gpt-5.5-mini',
    ]);
    expect(fake.calls.map((call) => call.apiKey)).toEqual([ANTHROPIC_KEY, OPENAI_KEY]);
  });

  it('balance 0 → CreditExhaustedError, the model is never reached', async () => {
    const companyId = await seedCompany('zero', 0);
    const { gateway } = gatewayWith();
    await expect(
      gateway.generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(CreditExhaustedError);
    expect(fake.calls).toEqual([]);
    expect(await costsOf(companyId)).toEqual([]);
    expect(await readBalance(app, companyId)).toBe(0);
  });

  it('balance 1đ → the call goes through and is charged afterwards (may go negative)', async () => {
    const companyId = await seedCompany('one', 1);
    const { gateway } = gatewayWith();
    await gateway.generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 });
    expect(await readBalance(app, companyId)).toBe(1 - 346);
    await expect(
      gateway.generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(CreditExhaustedError);
  });

  it('a model without a price in effect is refused before any call', async () => {
    const companyId = await seedCompany('unpriced', 100_000);
    await app.db.insert(modelPrices).values({
      provider: 'openai',
      model: 'gpt-future',
      inputUsdMicrosPerMtok: 1,
      outputUsdMicrosPerMtok: 1,
      cacheReadUsdMicrosPerMtok: 1,
      effectiveFrom: new Date(Date.now() + 86_400_000),
    });
    const { gateway } = gatewayWith();
    await expect(
      gateway.generate({
        companyId,
        model: { provider: 'openai', id: 'gpt-future' },
        messages: hello,
        maxOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(ModelNotPricedError);
    expect(fake.calls).toEqual([]);
    expect(await costsOf(companyId)).toEqual([]);
  });

  it('a provider error is not charged', async () => {
    const companyId = await seedCompany('fail', 100_000);
    fake.reply = { inputTokens: 0, outputTokens: 0, failWithStatus: 500 };
    const { gateway } = gatewayWith();
    const error = await gateway
      .generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderCallError);
    expect(error).toMatchObject({ status: 500, code: 'server' });
    expect(await costsOf(companyId)).toEqual([]);
    expect(await readBalance(app, companyId)).toBe(100_000);
  });

  it('no company → refused before anything is sent', async () => {
    const { gateway } = gatewayWith();
    await expect(
      gateway.generate({ companyId: '', model: sonnet, messages: hello, maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(NoCompanyError);
    expect(fake.calls).toEqual([]);
  });

  it('company B never sees the CostEntry of company A', async () => {
    const a = await seedCompany('iso-a', 100_000);
    const b = await seedCompany('iso-b', 100_000);
    const { gateway } = gatewayWith();
    await gateway.generate({ companyId: a, model: sonnet, messages: hello, maxOutputTokens: 10 });
    expect(await costsOf(b)).toEqual([]);
    expect(await costsOf(a)).toHaveLength(1);
  });

  it('sends the exhausted email event after the commit', async () => {
    const companyId = await seedCompany('notify', 300);
    const notifier = { lowBalance: vi.fn(async () => {}), exhausted: vi.fn(async () => {}) };
    const { gateway } = gatewayWith({ notifier });
    await gateway.generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 });
    expect(notifier.exhausted).toHaveBeenCalledWith(companyId);
  });
});

describe('ledger write fails after a paid call (code review)', () => {
  it('retries, then throws UsageNotRecordedError and logs what is needed to bill by hand', async () => {
    const companyId = await seedCompany('ledger-down', 100_000);
    let transactions = 0;
    // First transaction = the balance check; every ledger write after it fails.
    const flaky = {
      ...app,
      db: new Proxy(app.db, {
        get(target, prop, receiver) {
          if (prop === 'transaction') {
            return (...args: Parameters<typeof target.transaction>) => {
              transactions += 1;
              if (transactions > 1) return Promise.reject(new Error('connection terminated'));
              return target.transaction(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    };
    const gateway = createGateway({
      database: flaky,
      keys: createProviderKeyStore({ database: app, box }),
      models: fake,
      logger: captureLogger(),
      maxRetries: 0,
    });
    await expect(
      gateway.generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(UsageNotRecordedError);
    expect(transactions).toBe(4); // balance check + 3 attempts
    const log = lines.join('\n');
    expect(log).toContain('model call not recorded');
    expect(log).toContain(companyId);
    expect(log).toContain('"inputTokens":1000');
    expect(log).not.toContain(ANTHROPIC_KEY);
    expect(await costsOf(companyId)).toEqual([]);
  });
});

describe('ProviderKeyStore (task 5.2)', () => {
  it('stores only the ciphertext and caches for 60 s', async () => {
    const [row] = await app.db
      .select({ sealed: providerKeys.sealed })
      .from(providerKeys)
      .where(eq(providerKeys.provider, 'anthropic'));
    expect(row?.sealed).toMatch(/^v1\./);
    expect(row?.sealed).not.toContain(ANTHROPIC_KEY);
    let clock = 0;
    const keys = createProviderKeyStore({ database: app, box, now: () => clock });
    expect(await keys.get('anthropic')).toBe(ANTHROPIC_KEY);
    const select = vi.spyOn(app.db, 'select');
    clock = 59_000;
    await keys.get('anthropic');
    expect(select).not.toHaveBeenCalled();
    clock = 61_000;
    await keys.get('anthropic');
    expect(select).toHaveBeenCalledTimes(1);
    select.mockRestore();
  });

  it('a ciphertext copied to another provider row does not open', async () => {
    const owner = createDatabase(pg.ownerUrl, { max: 1 });
    try {
      const keys = createProviderKeyStore({ database: app, box });
      await keys.save('openai', OPENAI_KEY, randomUUID());
      await owner.pool.query(
        "update provider_keys set sealed = (select sealed from provider_keys where provider = 'anthropic') where provider = 'openai'",
      );
      await expect(keys.get('openai')).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      // The gateway reports "not configured" and charges nothing.
      const companyId = await seedCompany('moved', 100_000);
      const { gateway } = gatewayWith();
      await expect(
        gateway.generate({ companyId, model: gpt, messages: hello, maxOutputTokens: 10 }),
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      expect(await readBalance(app, companyId)).toBe(100_000);
    } finally {
      await createProviderKeyStore({ database: app, box }).save('openai', OPENAI_KEY, randomUUID());
      await owner.close();
    }
  });

  it('saving a new key replaces the old one immediately in this process', async () => {
    const keys = createProviderKeyStore({ database: app, box });
    expect(await keys.get('openai')).toBe(OPENAI_KEY);
    await keys.save('openai', 'sk-test-NEW', randomUUID());
    expect(await keys.get('openai')).toBe('sk-test-NEW');
    await keys.save('openai', OPENAI_KEY, randomUUID());
  });

  it('status never contains the key or the ciphertext', async () => {
    const status = await createProviderKeyStore({ database: app, box }).status();
    expect(status.map((item) => [item.provider, item.configured])).toEqual([
      ['anthropic', true],
      ['openai', true],
    ]);
    expect(JSON.stringify(status)).not.toMatch(/SECRET|v1\./);
  });
});

describe('keys never reach logs or errors (task 5.7)', () => {
  it.each([401, 500])(
    'provider %i: neither the log nor the thrown error has the key',
    async (status) => {
      const companyId = await seedCompany(`leak-${status}`, 100_000);
      fake.reply = { inputTokens: 0, outputTokens: 0, failWithStatus: status };
      const { gateway } = gatewayWith();
      const error = await gateway
        .generate({ companyId, model: sonnet, messages: hello, maxOutputTokens: 10 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderCallError);
      const thrown = JSON.stringify(error) + String(error) + String((error as Error).stack);
      expect(thrown).not.toContain(ANTHROPIC_KEY);
      expect((error as Error).cause).toBeUndefined();
      const log = lines.join('\n');
      expect(log).toContain('model call failed');
      expect(log).toContain(status === 401 ? '"code":"auth"' : '"code":"server"');
      expect(log).not.toContain(ANTHROPIC_KEY);
    },
  );
});
