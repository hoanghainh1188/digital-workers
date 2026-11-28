import { randomUUID } from 'node:crypto';
import { readBalance } from '@dw/billing';
import { createSecretBox } from '@dw/crypto';
import { costEntries, modelPrices, withCompany } from '@dw/db';
import { createGateway, createProviderKeyStore } from '@dw/llm';
import { createFakeModels } from '@dw/llm/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditEventsOf,
  cookieHeader,
  get,
  type Harness,
  makeApp,
  PLATFORM_ADMIN_EMAIL,
  signIn,
  signUp,
  startHarness,
  TEST_ENCRYPTION_KEY,
  type TestApp,
  testConfig,
  WEB_ORIGIN,
} from './support/harness.ts';
import { call, type OrgTenant, seedOrg } from './support/org.ts';
import {
  authPost,
  giveCredit,
  type PlatformAdmin,
  setUpPlatformAdmin,
  signInPlatformAdmin,
  totp,
} from './support/platform.ts';

let h: Harness;
let t: TestApp;
let admin: PlatformAdmin;
let org: OrgTenant;
const verifyKey = vi.fn(async (_provider: string, apiKey: string) =>
  apiKey.includes('BAD') ? ('invalid' as const) : ('ok' as const),
);

function adjust(cookie: string, companyId: string, body: object, key: string = randomUUID()) {
  return t.app.inject({
    method: 'POST',
    url: `/api/platform/companies/${companyId}/credit-adjustments`,
    headers: { origin: WEB_ORIGIN, cookie, 'idempotency-key': key },
    payload: body,
  });
}

async function platformEvents() {
  const { rows } = await h.database.pool.query(
    'select action, target_type, target_id, company_id, fields from platform_audit_events order by created_at',
  );
  return rows as Array<{ action: string; target_id: string | null; fields: string[] | null }>;
}

beforeAll(async () => {
  h = await startHarness();
  t = makeApp(h, { verifyKey });
  org = await seedOrg(t, h, 'Gốm An Phú');
  admin = await setUpPlatformAdmin(t, h);
});

afterAll(async () => {
  await h?.stop();
});

describe('platform admin identity (task 6.3, spec "Danh tính platform admin")', () => {
  it('an email in the list with TOTP gets 200', async () => {
    const res = await get(t.app, '/api/platform/companies', admin.cookie);
    expect(res.statusCode).toBe(200);
  });

  it('/api/me tells the web this is a platform admin (no company)', async () => {
    const me = (await get(t.app, '/api/me', admin.cookie)).json();
    expect(me).toMatchObject({
      member: null,
      company: null,
      platformAdmin: { twoFactorEnabled: true },
    });
    const owner = (await get(t.app, '/api/me', org.owner.cookie)).json();
    expect(owner.platformAdmin).toBeUndefined();
  });

  it('an email in the list that is Owner of a company gets 404, like everyone else', async () => {
    const both = makeApp(h, {
      verifyKey,
      config: { ...testConfig, PLATFORM_ADMIN_EMAILS: [PLATFORM_ADMIN_EMAIL, org.owner.email] },
    });
    const res = await get(both.app, '/api/platform/companies', org.owner.cookie);
    expect(res.statusCode).toBe(404);
  });

  it('a platform admin cannot create a company (task 6.4)', async () => {
    const res = await call(t.app, 'POST', '/api/companies', admin.cookie, { name: 'Lậu' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PLATFORM_ADMIN');
    const { rows } = await h.owner.pool.query(
      "select count(*)::int as n from companies where name = 'Lậu'",
    );
    expect(rows[0].n).toBe(0);
  });

  it('signing up with a platform admin email creates the account but no company', async () => {
    const other = makeApp(h, {
      verifyKey,
      config: { ...testConfig, PLATFORM_ADMIN_EMAILS: ['second-admin@platform.test'] },
    });
    const res = await other.app.inject({
      method: 'POST',
      url: '/api/signup',
      headers: { origin: WEB_ORIGIN },
      payload: {
        companyName: 'Không được tạo',
        name: 'Admin 2',
        email: 'second-admin@platform.test',
        password: 'gom an phu bat trang',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ companyId: null, platformAdmin: true });
    const { rows } = await h.owner.pool.query(
      "select count(*)::int as n from companies where name = 'Không được tạo'",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('two-step verification (tasks 6.2, 6.3)', () => {
  it('without TOTP the admin gets 403 TWO_FACTOR_REQUIRED and no data', async () => {
    const fresh = makeApp(h, {
      verifyKey,
      config: { ...testConfig, PLATFORM_ADMIN_EMAILS: ['no-totp@platform.test'] },
    });
    const signed = await fresh.app.inject({
      method: 'POST',
      url: '/api/signup',
      headers: { origin: WEB_ORIGIN },
      payload: {
        companyName: 'x',
        name: 'x',
        email: 'no-totp@platform.test',
        password: 'gom an phu bat trang',
      },
    });
    await h.database.pool.query(
      "update auth.users set email_verified = true where email = 'no-totp@platform.test'",
    );
    const res = await get(fresh.app, '/api/platform/companies', cookieHeader(signed));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'TWO_FACTOR_REQUIRED', message: 'Turn on two-step verification first' },
    });
  });

  it('a correct password alone gives no session until the TOTP code', async () => {
    const first = await signIn(t.app, PLATFORM_ADMIN_EMAIL);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ twoFactorRedirect: true });
    const challenge = cookieHeader(first);
    expect((await get(t.app, '/api/me', challenge)).statusCode).toBe(401);
    expect((await get(t.app, '/api/platform/companies', challenge)).statusCode).toBe(404);

    const cookie = await signInPlatformAdmin(t, admin);
    expect((await get(t.app, '/api/platform/companies', cookie)).statusCode).toBe(200);
  });

  it('a wrong code gives no session and counts towards the lockout', async () => {
    const first = await signIn(t.app, PLATFORM_ADMIN_EMAIL);
    const challenge = cookieHeader(first);
    const before = await h.owner.pool.query(
      'select failed_verification_count from auth.two_factors',
    );
    const wrong = totp(admin.secret) === '000000' ? '111111' : '000000';
    const res = await authPost(t.app, '/two-factor/verify-totp', challenge, { code: wrong });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.some((c) => c.name.endsWith('session_token') && c.value)).toBe(false);
    const after = await h.owner.pool.query(
      'select failed_verification_count from auth.two_factors',
    );
    expect(after.rows[0].failed_verification_count).toBe(
      before.rows[0].failed_verification_count + 1,
    );
  });

  it('"remember this device" is ignored: the next sign-in asks for a code again', async () => {
    const first = await signIn(t.app, PLATFORM_ADMIN_EMAIL);
    const verified = await authPost(t.app, '/two-factor/verify-totp', cookieHeader(first), {
      code: totp(admin.secret),
      trustDevice: true,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.cookies.some((c) => c.name.includes('trust_device') && c.value)).toBe(false);
    const again = await signIn(t.app, PLATFORM_ADMIN_EMAIL);
    expect(again.json()).toMatchObject({ twoFactorRedirect: true });
  });

  it('a session signed in 13 hours ago gets 401 REAUTH_REQUIRED', async () => {
    const later = makeApp(h, { verifyKey, now: () => new Date(Date.now() + 13 * 3_600_000) });
    const res = await get(later.app, '/api/platform/companies', admin.cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('REAUTH_REQUIRED');
  });

  it('an admin email that is not verified yet cannot enrol TOTP (squatting)', async () => {
    const squat = makeApp(h, {
      verifyKey,
      config: { ...testConfig, PLATFORM_ADMIN_EMAILS: ['squat@platform.test'] },
    });
    const signed = await squat.app.inject({
      method: 'POST',
      url: '/api/signup',
      headers: { origin: WEB_ORIGIN },
      payload: {
        companyName: 'x',
        name: 'x',
        email: 'squat@platform.test',
        password: 'gom an phu bat trang',
      },
    });
    const res = await authPost(squat.app, '/two-factor/enable', cookieHeader(signed), {
      password: 'gom an phu bat trang',
    });
    expect(res.statusCode).toBe(404);
  });

  it('anyone else calling /two-factor/enable gets 404', async () => {
    const res = await authPost(t.app, '/two-factor/enable', org.owner.cookie, {
      password: 'gom an phu bat trang',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('outsiders never see the admin API (spec "Người khác không thấy màn quản trị")', () => {
  it('an Owner adjusting credit gets 404, no transaction, and an access.not_found event', async () => {
    const res = await adjust(org.owner.cookie, org.companyId, {
      direction: 'credit',
      amountVnd: 1_000_000,
      reason: 'other',
      note: 'tự cộng',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(await readBalance(h.database, org.companyId)).toBe(0);
    const events = await auditEventsOf(h, org.companyId);
    expect(events.at(-1)).toMatchObject({ action: 'access.not_found', target_type: 'platform' });
  });

  it('an invalid body from an outsider is still 404 (the guard runs before validation)', async () => {
    const res = await adjust(org.member.cookie, 'not-a-uuid', { nonsense: true }, 'not-a-uuid');
    expect(res.statusCode).toBe(404);
  });

  it('signed out → 404', async () => {
    expect((await get(t.app, '/api/platform/companies')).statusCode).toBe(404);
  });
});

describe('company list (task 8.1, spec "Chỉ xem tổng theo công ty")', () => {
  it('has only the aggregate fields, and the exhausted filter works', async () => {
    const res = await get(t.app, '/api/platform/companies?state=all', admin.cookie);
    const { companies, totals } = res.json();
    const row = companies.find((c: { id: string }) => c.id === org.companyId);
    expect(Object.keys(row).sort()).toEqual([
      'balanceVnd',
      'charged30dVnd',
      'id',
      'lastUsedAt',
      'multiplierPermille',
      'name',
      'ownerEmail',
      'state',
    ]);
    expect(row).toMatchObject({
      name: 'Gốm An Phú',
      ownerEmail: org.owner.email,
      state: 'exhausted',
    });
    expect(Object.keys(totals).sort()).toEqual([
      'balanceVnd',
      'charged30dVnd',
      'companies',
      'exhausted',
      'realCost30dVnd',
    ]);
    const rich = (await signUp(t.app, { companyName: 'Đại lý Hồng Phát' })).companyId ?? '';
    await giveCredit(h, rich, 500_000);
    const exhausted = (
      await get(t.app, '/api/platform/companies?state=exhausted', admin.cookie)
    ).json();
    expect(exhausted.companies.every((c: { balanceVnd: number }) => c.balanceVnd <= 0)).toBe(true);
    expect(exhausted.companies.some((c: { id: string }) => c.id === rich)).toBe(false);
    const search = (await get(t.app, '/api/platform/companies?q=hồng', admin.cookie)).json();
    expect(search.companies.map((c: { id: string }) => c.id)).toEqual([rich]);
  });
});

describe('manual credit adjustments (task 8.2)', () => {
  it('credit 2.000.000đ "đã nhận chuyển khoản" → balance, and the gateway works again', async () => {
    const companyId = (await signUp(t.app, { companyName: 'Cộng tay' })).companyId ?? '';
    const res = await adjust(admin.cookie, companyId, {
      direction: 'credit',
      amountVnd: 2_000_000,
      reason: 'bank_transfer',
      note: 'CK ngày 27/11, nội dung DW-0042',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: 'adjustment',
      amountVnd: 2_000_000,
      balanceAfterVnd: 2_000_000,
    });
    expect(await readBalance(h.database, companyId)).toBe(2_000_000);

    await h.database.db.insert(modelPrices).values({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputUsdMicrosPerMtok: 3_000_000,
      outputUsdMicrosPerMtok: 15_000_000,
      cacheReadUsdMicrosPerMtok: 300_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    const keys = createProviderKeyStore({
      database: h.database,
      box: createSecretBox(TEST_ENCRYPTION_KEY),
    });
    await keys.save('anthropic', 'sk-ant-test-0000', admin.userId);
    const gateway = createGateway({
      database: h.database,
      keys,
      models: createFakeModels(),
      logger: { info() {}, warn() {}, error() {} },
      maxRetries: 0,
    });
    const reply = await gateway.generate({
      companyId,
      model: { provider: 'anthropic', id: 'claude-sonnet-5-5' },
      messages: [{ role: 'user', content: 'Chào' }],
      maxOutputTokens: 100,
    });
    expect(reply.chargeVnd).toBe(346);
    const entries = await withCompany(h.database, companyId, (tx) => tx.select().from(costEntries));
    expect(entries).toHaveLength(1);
  });

  it('missing note → 400, nothing written', async () => {
    const res = await adjust(admin.cookie, org.companyId, {
      direction: 'credit',
      amountVnd: 1000,
      reason: 'other',
    });
    expect(res.statusCode).toBe(400);
    expect(await readBalance(h.database, org.companyId)).toBe(0);
  });

  it('a note with 9+ consecutive digits → 400 (no full account numbers)', async () => {
    const res = await adjust(admin.cookie, org.companyId, {
      direction: 'credit',
      amountVnd: 1000,
      reason: 'bank_transfer',
      note: 'STK 0123456789',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ path: 'note', message: 'note_account_number' }]);
  });

  it('above 100.000.000đ → 400', async () => {
    const res = await adjust(admin.cookie, org.companyId, {
      direction: 'credit',
      amountVnd: 100_000_001,
      reason: 'other',
      note: 'x',
    });
    expect(res.statusCode).toBe(400);
  });

  it('debiting more than the balance → 422, balance unchanged', async () => {
    const companyId = (await signUp(t.app, { companyName: 'Trừ quá' })).companyId ?? '';
    await giveCredit(h, companyId, 86_200);
    const res = await adjust(admin.cookie, companyId, {
      direction: 'debit',
      amountVnd: 100_000,
      reason: 'system_fix',
      note: 'trừ thử',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await readBalance(h.database, companyId)).toBe(86_200);
  });

  it('the same Idempotency-Key twice → one transaction, the second returns the first', async () => {
    const companyId = (await signUp(t.app, { companyName: 'Gửi lại' })).companyId ?? '';
    const key = randomUUID();
    const body = { direction: 'credit', amountVnd: 500_000, reason: 'bank_transfer', note: 'CK' };
    const first = await adjust(admin.cookie, companyId, body, key);
    const second = await adjust(admin.cookie, companyId, body, key);
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(second.json().id).toBe(first.json().id);
    expect(await readBalance(h.database, companyId)).toBe(500_000);
  });

  it('the same key with a different request → 409, nothing new written', async () => {
    const companyId = (await signUp(t.app, { companyName: 'Khoá trùng' })).companyId ?? '';
    const key = randomUUID();
    const body = { direction: 'credit', amountVnd: 100_000, reason: 'other', note: 'lần 1' };
    expect((await adjust(admin.cookie, companyId, body, key)).statusCode).toBe(201);
    const other = await adjust(admin.cookie, companyId, { ...body, amountVnd: 900_000 }, key);
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await readBalance(h.database, companyId)).toBe(100_000);
  });

  it('an unknown company → 404', async () => {
    const res = await adjust(admin.cookie, randomUUID(), {
      direction: 'credit',
      amountVnd: 1000,
      reason: 'other',
      note: 'x',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('prices, exchange rate and multipliers (task 8.3)', () => {
  const price = {
    provider: 'openai',
    model: 'gpt-5.5-mini',
    inputUsdMicrosPerMtok: 400_000,
    outputUsdMicrosPerMtok: 1_600_000,
    cacheReadUsdMicrosPerMtok: 40_000,
    cacheWriteUsdMicrosPerMtok: null,
  };

  it('a price effective yesterday → 400; a duplicate start → 409', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const past = await call(t.app, 'POST', '/api/platform/model-prices', admin.cookie, {
      ...price,
      effectiveFrom: yesterday,
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().error.code).toBe('EFFECTIVE_IN_PAST');

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const ok = await call(t.app, 'POST', '/api/platform/model-prices', admin.cookie, {
      ...price,
      effectiveFrom: tomorrow,
    });
    expect(ok.statusCode).toBe(201);
    const dup = await call(t.app, 'POST', '/api/platform/model-prices', admin.cookie, {
      ...price,
      inputUsdMicrosPerMtok: 1,
      effectiveFrom: tomorrow,
    });
    expect(dup.statusCode).toBe(409);
    const list = (await get(t.app, '/api/platform/model-prices', admin.cookie)).json();
    const scheduled = list.prices.filter((p: { model: string }) => p.model === 'gpt-5.5-mini');
    expect(scheduled).toEqual([
      expect.objectContaining({ inputUsdMicrosPerMtok: 400_000, status: 'scheduled' }),
    ]);
    expect(list).toMatchObject({ fxRate: 25_400, defaultMultiplierPermille: 1300 });
  });

  it('a company multiplier below 1 → 400, unchanged; set and clear work', async () => {
    const url = `/api/platform/companies/${org.companyId}/multiplier`;
    const low = await t.app.inject({
      method: 'PUT',
      url,
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
      payload: { permille: 900 },
    });
    expect(low.statusCode).toBe(400);
    const set = await t.app.inject({
      method: 'PUT',
      url,
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
      payload: { permille: 1150 },
    });
    expect(set.statusCode).toBe(200);
    let row = (await get(t.app, '/api/platform/companies', admin.cookie))
      .json()
      .companies.find((c: { id: string }) => c.id === org.companyId);
    expect(row.multiplierPermille).toBe(1150);
    const cleared = await t.app.inject({
      method: 'DELETE',
      url,
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
    });
    expect(cleared.statusCode).toBe(204);
    row = (await get(t.app, '/api/platform/companies', admin.cookie))
      .json()
      .companies.find((c: { id: string }) => c.id === org.companyId);
    expect(row.multiplierPermille).toBeNull();
  });

  it('changes the exchange rate and default multiplier', async () => {
    expect(
      (await call(t.app, 'POST', '/api/platform/fx-rates', admin.cookie, { vndPerUsd: 0 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(t.app, 'POST', '/api/platform/multipliers', admin.cookie, { permille: 999 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(t.app, 'POST', '/api/platform/fx-rates', admin.cookie, { vndPerUsd: 26_000 }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(t.app, 'POST', '/api/platform/multipliers', admin.cookie, { permille: 1250 }))
        .statusCode,
    ).toBe(201);
    const list = (await get(t.app, '/api/platform/model-prices', admin.cookie)).json();
    expect(list).toMatchObject({ fxRate: 26_000, defaultMultiplierPermille: 1250 });
    // Back to the defaults for the other tests in this file.
    await call(t.app, 'POST', '/api/platform/fx-rates', admin.cookie, { vndPerUsd: 25_400 });
    await call(t.app, 'POST', '/api/platform/multipliers', admin.cookie, { permille: 1300 });
  });
});

describe('provider keys (task 8.4, spec secret-encryption)', () => {
  const GOOD = 'sk-test-openai-GOOD-123456';

  it('a rejected key → 400 INVALID_KEY and the old one stays', async () => {
    const saved = await t.app.inject({
      method: 'PUT',
      url: '/api/platform/provider-keys/openai',
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
      payload: { apiKey: GOOD },
    });
    expect(saved.statusCode).toBe(200);
    const { rows: before } = await h.database.pool.query(
      "select sealed from provider_keys where provider = 'openai'",
    );
    const bad = await t.app.inject({
      method: 'PUT',
      url: '/api/platform/provider-keys/openai',
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
      payload: { apiKey: 'sk-test-openai-BAD-999999' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_KEY');
    const { rows: after } = await h.database.pool.query(
      "select sealed from provider_keys where provider = 'openai'",
    );
    expect(after).toEqual(before);
  });

  it('stores only the ciphertext; responses and logs never contain the key', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/platform/provider-keys/anthropic',
      headers: { origin: WEB_ORIGIN, cookie: admin.cookie },
      payload: { apiKey: 'sk-ant-api03-LEAKCHECK-777' },
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual([
      'configured',
      'lastOkAt',
      'provider',
      'updatedAt',
    ]);
    const { rows } = await h.database.pool.query('select sealed from provider_keys');
    for (const row of rows) expect(row.sealed).not.toContain('LEAKCHECK');
    const list = await get(t.app, '/api/platform/provider-keys', admin.cookie);
    expect(
      list
        .json()
        .keys.map((k: { provider: string; configured: boolean }) => [k.provider, k.configured]),
    ).toEqual([
      ['anthropic', true],
      ['openai', true],
    ]);
    expect(list.body).not.toMatch(/LEAKCHECK|GOOD-123456|v1\./);
    expect(t.logs()).not.toMatch(/LEAKCHECK|GOOD-123456/);
    const keys = createProviderKeyStore({
      database: h.database,
      box: createSecretBox(TEST_ENCRYPTION_KEY),
    });
    expect(await keys.get('anthropic')).toBe('sk-ant-api03-LEAKCHECK-777');
  });
});

describe('platform audit log (task 8.5)', () => {
  it('each change wrote exactly one event, with field names and never a key', async () => {
    const events = await platformEvents();
    const actions = events.map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'credit.adjusted',
        'company_multiplier.set',
        'company_multiplier.cleared',
        'price.added',
        'fx.changed',
        'multiplier.changed',
        'provider_key.replaced',
      ]),
    );
    // Rejected requests (400 / 404 / 409 / 422, invalid key) wrote nothing.
    expect(actions.filter((a) => a === 'price.added')).toHaveLength(1);
    expect(actions.filter((a) => a === 'provider_key.replaced')).toHaveLength(2);
    expect(actions.filter((a) => a === 'credit.adjusted')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toMatch(/sk-|LEAKCHECK|GOOD/);
  });

  it('the application cannot delete platform audit events', async () => {
    await expect(h.database.pool.query('delete from platform_audit_events')).rejects.toThrow(
      /permission denied/,
    );
  });
});
