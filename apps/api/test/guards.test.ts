import type { AuditEventInput } from '@dw/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandling } from '../src/plugins/errors.ts';
import { createGuards, type RequestContext } from '../src/tenancy/index.ts';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: '33333333-3333-4333-8333-333333333333',
    name: 'An',
    email: 'an@example.com',
    emailVerified: true,
    member: { memberId: MEMBER, companyId: COMPANY, role: 'owner', status: 'active' },
    ...overrides,
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A bare app whose request context is `ctx`, with every guard on its own route. */
function makeApp(ctx: RequestContext | null) {
  const audits: Array<{ companyId: string; event: AuditEventInput }> = [];
  const guards = createGuards({
    audit: async (companyId, event) => {
      audits.push({ companyId, event });
    },
  });
  app = Fastify();
  registerErrorHandling(app);
  app.decorateRequest('ctx', null);
  app.addHook('onRequest', async (request) => {
    request.ctx = ctx;
  });
  const ok = async () => ({ ok: true });
  app.get('/auth', { preHandler: guards.requireAuth }, ok);
  app.get('/company', { preHandler: guards.requireCompany }, ok);
  app.patch('/company', { preHandler: guards.requirePermission('company.update') }, ok);
  app.get('/verified', { preHandler: guards.requireVerifiedEmail }, ok);
  app.get('/things/:id', { preHandler: guards.requireCompany }, async (request, reply) =>
    guards.notFound(request, reply, 'thing', (request.params as { id: string }).id),
  );
  return { app, audits };
}

describe('requireAuth', () => {
  it('401 without a session', async () => {
    const res = await makeApp(null).app.inject({ method: 'GET', url: '/auth' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('passes with a session, even without a company', async () => {
    const res = await makeApp(context({ member: null })).app.inject({
      method: 'GET',
      url: '/auth',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('requireCompany', () => {
  it('409 NO_COMPANY for a signed-in user without a company', async () => {
    const res = await makeApp(context({ member: null })).app.inject({
      method: 'GET',
      url: '/company',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_COMPANY');
  });

  it('403 for a locked member', async () => {
    const ctx = context();
    const locked = context({ member: { ...(ctx.member ?? ({} as never)), status: 'locked' } });
    const res = await makeApp(locked).app.inject({ method: 'GET', url: '/company' });
    expect(res.statusCode).toBe(403);
  });
});

describe('requirePermission', () => {
  it.each(['owner', 'admin'] as const)('%s may update the company', async (role) => {
    const ctx = context();
    const { app, audits } = makeApp(
      context({ member: { ...(ctx.member ?? ({} as never)), role } }),
    );
    const res = await app.inject({ method: 'PATCH', url: '/company' });
    expect(res.statusCode).toBe(200);
    expect(audits).toEqual([]);
  });

  it.each(['manager', 'member'] as const)(
    '%s gets 403 and an access.denied AuditEvent',
    async (role) => {
      const ctx = context();
      const { app, audits } = makeApp(
        context({ member: { ...(ctx.member ?? ({} as never)), role } }),
      );
      const res = await app.inject({ method: 'PATCH', url: '/company' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect(audits).toEqual([
        {
          companyId: COMPANY,
          event: {
            actorMemberId: MEMBER,
            action: 'access.denied',
            targetType: 'action',
            targetId: 'company.update',
          },
        },
      ]);
    },
  );

  it('still answers 401 / 409 before checking the role', async () => {
    expect((await makeApp(null).app.inject({ method: 'PATCH', url: '/company' })).statusCode).toBe(
      401,
    );
    const res = await makeApp(context({ member: null })).app.inject({
      method: 'PATCH',
      url: '/company',
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('requireVerifiedEmail', () => {
  it('403 EMAIL_NOT_VERIFIED when the email is not verified', async () => {
    const res = await makeApp(context({ emailVerified: false })).app.inject({
      method: 'GET',
      url: '/verified',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('passes once verified', async () => {
    const res = await makeApp(context()).app.inject({ method: 'GET', url: '/verified' });
    expect(res.statusCode).toBe(200);
  });
});

describe('notFound', () => {
  it('returns the generic 404 body and records access.not_found with the requested id', async () => {
    const { app, audits } = makeApp(context());
    const res = await app.inject({ method: 'GET', url: '/things/abc' });
    const unknownRoute = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(unknownRoute.body);
    expect(audits).toEqual([
      {
        companyId: COMPANY,
        event: {
          actorMemberId: MEMBER,
          action: 'access.not_found',
          targetType: 'thing',
          targetId: 'abc',
        },
      },
    ]);
  });
});
