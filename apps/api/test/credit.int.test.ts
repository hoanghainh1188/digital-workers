import { randomUUID } from 'node:crypto';
import { recordUsage } from '@dw/billing';
import { creditTransactions, modelPrices, withCompany } from '@dw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsOf,
  cookieHeader,
  get,
  type Harness,
  makeApp,
  STRONG_PASSWORD,
  signUp,
  startHarness,
  type TestApp,
  uniqueEmail,
  verificationLink,
  WEB_ORIGIN,
} from './support/harness.ts';
import { addPerson, call, type OrgTenant, seedOrg, verifyEmail } from './support/org.ts';
import { giveCredit } from './support/platform.ts';

let h: Harness;
let t: TestApp;
let a: OrgTenant;
let b: OrgTenant;

async function trialsOf(companyId: string) {
  return withCompany(h.database, companyId, (tx) =>
    tx
      .select({ kind: creditTransactions.kind, amount: creditTransactions.amountVnd })
      .from(creditTransactions),
  );
}

/** Follows the newest verification link sent to `email`. */
async function openVerificationLink(email: string) {
  const link = new URL(verificationLink(t.sent, email));
  const token = link.searchParams.get('token') ?? '';
  return get(t.app, `/api/auth/verify-email?token=${encodeURIComponent(token)}`);
}

/** One recorded call (1.000 in / 500 out of claude-sonnet-5-5 ≈ 346,71đ), straight into the ledger. */
async function spend(companyId: string, workerId: string | null, at = new Date()) {
  const [price] = await h.database.db.select().from(modelPrices).limit(1);
  if (!price) throw new Error('no price');
  return recordUsage(h.database, {
    companyId,
    workerId,
    price: { ...price, provider: 'anthropic' },
    usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    at,
  });
}

async function setStatus(companyId: string, memberId: string, status: 'locked' | 'active') {
  const client = await h.database.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    await client.query('update members set status = $1, locked_at = $2 where id = $3', [
      status,
      status === 'locked' ? new Date() : null,
      memberId,
    ]);
    await client.query('commit');
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  h = await startHarness();
  t = makeApp(h);
  a = await seedOrg(t, h, 'Gốm An Phú');
  b = await seedOrg(t, h, 'Đại lý Hồng Phát');
  await h.database.db.insert(modelPrices).values({
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    inputUsdMicrosPerMtok: 3_000_000,
    outputUsdMicrosPerMtok: 15_000_000,
    cacheReadUsdMicrosPerMtok: 300_000,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('account and trial credit (task 7.1, spec "Credit dùng thử")', () => {
  it('email sign-up → 0đ; opening the verification link → +200.000đ', async () => {
    const owner = await signUp(t.app, { companyName: 'Xưởng Mộc Bình An' });
    const before = (await get(t.app, '/api/credit', owner.cookie)).json();
    expect(before).toMatchObject({
      balanceVnd: 0,
      state: 'exhausted',
      trial: 'pending_verification',
    });

    const verified = await openVerificationLink(owner.email);
    expect(verified.statusCode).toBeLessThan(400);
    const after = (await get(t.app, '/api/credit', owner.cookie)).json();
    expect(after).toMatchObject({
      balanceVnd: 200_000,
      state: 'normal',
      thresholdVnd: 40_000,
      trial: 'granted',
    });
    expect(await trialsOf(owner.companyId ?? '')).toEqual([{ kind: 'trial', amount: 200_000 }]);
  });

  it('an already-verified account (Google) creating a company gets the trial at once', async () => {
    const email = uniqueEmail('google');
    const account = await t.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: WEB_ORIGIN },
      payload: { name: 'Google', email, password: STRONG_PASSWORD },
    });
    await verifyEmail(h, email);
    const cookie = cookieHeader(account);
    const created = await call(t.app, 'POST', '/api/companies', cookie, { name: 'Trà Tân Cương' });
    expect(created.statusCode).toBe(201);
    expect(await trialsOf(created.json().companyId)).toEqual([{ kind: 'trial', amount: 200_000 }]);
  });

  it('a second Owner verifying later gives no second trial', async () => {
    const owner = await signUp(t.app, { companyName: 'Hai Owner' });
    await openVerificationLink(owner.email);
    const second = await addPerson(t, h, owner.companyId ?? '', 'owner', null);
    await openVerificationLink(second.email);
    expect(await trialsOf(owner.companyId ?? '')).toEqual([{ kind: 'trial', amount: 200_000 }]);
  });

  it('an Admin verifying while no Owner is verified gives no trial', async () => {
    const owner = await signUp(t.app, { companyName: 'Chưa xác minh' });
    const admin = await addPerson(t, h, owner.companyId ?? '', 'admin', null);
    await openVerificationLink(admin.email);
    expect(await trialsOf(owner.companyId ?? '')).toEqual([]);
  });

  it('every company created through the API has a credit account', async () => {
    const res = await get(t.app, '/api/credit', a.owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().balanceVnd).toBe(0);
  });
});

describe('credit emails (task 7.2, specs "Báo credit sắp hết" / "Báo hết credit")', () => {
  it('"exhausted" goes to active Owner, Admin and Trưởng phòng of that company only', async () => {
    await setStatus(a.companyId, a.admin.memberId, 'locked');
    const sentBefore = t.sent.length;
    await t.platform.notifier.exhausted(a.companyId);
    const to = t.sent
      .slice(sentBefore)
      .map((email) => email.to)
      .sort();
    expect(to).toEqual([a.owner.email, a.manager.email].sort());
    expect(to).not.toContain(a.member.email);
    for (const person of [b.owner, b.admin, b.manager, b.member])
      expect(to).not.toContain(person.email);
    const mail = t.sent.at(-1);
    expect(mail?.subject).toBe('Gốm An Phú đã hết credit — Digital Workers');
    await setStatus(a.companyId, a.admin.memberId, 'active');
  });

  it('"low" goes to Owners only, with the balance and the threshold', async () => {
    const sentBefore = t.sent.length;
    await t.platform.notifier.lowBalance(a.companyId, 199_000, 200_000);
    const mails = t.sent.slice(sentBefore);
    expect(mails.map((mail) => mail.to)).toEqual([a.owner.email]);
    expect(mails[0]?.text).toContain('199.000đ');
    expect(mails[0]?.text).toContain('200.000đ');
  });

  it('logs never contain the recipients', () => {
    expect(t.logs()).not.toContain(a.owner.email);
    expect(t.logs()).not.toContain(a.manager.email);
  });
});

describe('credit API (task 7.3, spec "Xem số dư credit" / "Lịch sử credit")', () => {
  it('Owner and Admin get 200; Trưởng phòng and Nhân viên 403 with an AuditEvent', async () => {
    expect((await get(t.app, '/api/credit', a.owner.cookie)).statusCode).toBe(200);
    expect((await get(t.app, '/api/credit', a.admin.cookie)).statusCode).toBe(200);
    for (const person of [a.manager, a.member]) {
      const res = await get(t.app, '/api/credit', person.cookie);
      expect(res.statusCode).toBe(403);
      const events = await auditEventsOf(h, a.companyId);
      expect(events.at(-1)).toMatchObject({
        actor_member_id: person.memberId,
        action: 'access.denied',
        target_id: 'credit.view',
      });
    }
    expect((await get(t.app, '/api/credit/transactions', a.manager.cookie)).statusCode).toBe(403);
    expect(
      (await get(t.app, '/api/credit/usage?date=2026-11-28', a.member.cookie)).statusCode,
    ).toBe(403);
  });

  it('history and details: own company only, no real cost or multiplier', async () => {
    await giveCredit(h, a.companyId, 1_000_000);
    await giveCredit(h, b.companyId, 1_000_000);
    const workerA = randomUUID();
    const workerB = randomUUID();
    for (let i = 0; i < 3; i += 1) await spend(a.companyId, workerA);
    await spend(b.companyId, workerB);

    const overview = await get(t.app, '/api/credit', a.owner.cookie);
    expect(overview.json()).toMatchObject({
      balanceVnd: 1_000_000 - (346 + 347 + 347),
      month: { calls: 3 },
    });
    expect(overview.body).not.toMatch(/real|multiplier|permille|micro/i);

    const history = await get(t.app, '/api/credit/transactions?type=all', a.owner.cookie);
    expect(history.statusCode).toBe(200);
    const usage = history.json().entries.filter((e: { type: string }) => e.type === 'usage');
    expect(usage).toEqual([
      expect.objectContaining({ workerId: workerA, calls: 3, amountVnd: -1040 }),
    ]);
    expect(history.body).not.toContain(workerB);
    expect(history.body).not.toMatch(/real|multiplier|permille|micro/i);

    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const mine = await get(
      t.app,
      `/api/credit/usage?date=${today}&workerId=${workerA}`,
      a.owner.cookie,
    );
    expect(mine.json().calls).toHaveLength(3);
    const theirs = await get(
      t.app,
      `/api/credit/usage?date=${today}&workerId=${workerB}`,
      a.owner.cookie,
    );
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().calls).toEqual([]);

    const credits = await get(t.app, '/api/credit/transactions?type=credit', a.owner.cookie);
    expect(credits.json().entries.every((e: { type: string }) => e.type === 'credit')).toBe(true);
  });

  it('rejects malformed month / date', async () => {
    expect(
      (await get(t.app, '/api/credit/transactions?month=2026-13', a.owner.cookie)).statusCode,
    ).toBe(400);
    expect((await get(t.app, '/api/credit/usage?date=28-11-2026', a.owner.cookie)).statusCode).toBe(
      400,
    );
    expect((await get(t.app, '/api/credit/usage?date=2026-02-31', a.owner.cookie)).statusCode).toBe(
      400,
    );
  });
});

describe('GET /api/me credit flag (task 7.4)', () => {
  it('Trưởng phòng sees "exhausted" without the balance; Nhân viên has no credit field', async () => {
    const fresh = await seedOrg(t, h, 'Hết credit');
    const manager = (await get(t.app, '/api/me', fresh.manager.cookie)).json();
    expect(manager.credit).toEqual({ exhausted: true });
    const member = (await get(t.app, '/api/me', fresh.member.cookie)).json();
    expect(member.credit).toBeUndefined();
    await giveCredit(h, fresh.companyId, 10_000);
    const owner = (await get(t.app, '/api/me', fresh.owner.cookie)).json();
    expect(owner.credit).toEqual({ exhausted: false });
  });
});
