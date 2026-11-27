import { companyInput, companyPatchInput, describeError, signupInput } from '@dw/core';
import { type Database, memberProfiles, recordAudit, withCompany } from '@dw/db';
import { eq } from '@dw/db/drizzle';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Auth, signUpWithEmail } from '../auth/index.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import {
  AlreadyInCompanyError,
  type CreateCompany,
  companyContext,
  type Guards,
  readCompany,
  sendError,
  updateCompany,
} from '../tenancy/index.ts';

export type TenancyRouteDeps = {
  readonly auth: Auth;
  readonly database: Database;
  readonly guards: Guards;
  readonly createCompany: CreateCompany;
  readonly googleEnabled: boolean;
};

const company = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  contactPhone: z.string().nullable(),
});
const role = z.enum(['owner', 'admin', 'manager', 'member']);

const meResponse = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  member: z.strictObject({ id: z.uuid(), role }).nullable(),
  company: company.nullable(),
});

const memberResponse = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role,
  status: z.enum(['active', 'locked']),
});

/** Company signup, /me, company settings and member lookup (specs company-signup, access-control). */
export function registerTenancyRoutes(app: FastifyInstance, deps: TenancyRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;

  routes.get(
    '/api/config/public',
    { schema: { response: { 200: z.strictObject({ googleEnabled: z.boolean() }) } } },
    async () => ({ googleEnabled: deps.googleEnabled }),
  );

  routes.get(
    '/api/me',
    { preHandler: guards.requireAuth, schema: { response: { 200: meResponse } } },
    async (request) => {
      const ctx = request.ctx;
      if (!ctx) throw new Error('requireAuth did not run');
      const current = ctx.member
        ? await withCompany(database, ctx.member.companyId, readCompany)
        : null;
      return {
        user: {
          id: ctx.userId,
          name: ctx.name,
          email: ctx.email,
          emailVerified: ctx.emailVerified,
        },
        member: ctx.member ? { id: ctx.member.memberId, role: ctx.member.role } : null,
        company: current,
      };
    },
  );

  // Email signup = Better Auth account, then company + Owner (design D4). If the
  // second step fails the user is signed in without a company → /onboarding.
  routes.post('/api/signup', { schema: { body: signupInput } }, async (request, reply) => {
    const input = request.body;
    const account = await signUpWithEmail(
      deps.auth,
      { name: input.name, email: input.email, password: input.password },
      request.headers,
    );
    if (!account.ok) {
      if (account.code === 'USER_ALREADY_EXISTS' || account.code.includes('ALREADY_EXISTS')) {
        return sendError(reply, 409, 'EMAIL_TAKEN', 'Email already has an account');
      }
      if (account.code === 'PASSWORD_COMMON') {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: [{ path: 'password', message: 'password_common' }],
          },
        });
      }
      return sendError(reply, Math.max(account.status, 400), account.code, 'Sign-up failed');
    }
    reply.header('set-cookie', [...account.setCookies]);
    try {
      const created = await deps.createCompany({
        userId: account.userId,
        name: input.companyName,
        contactPhone: input.phone ?? null,
      });
      return reply.status(201).send({ companyId: created.companyId });
    } catch (error) {
      request.log.error({ error: describeError(error) }, 'company creation after sign-up failed');
      return reply.status(201).send({ companyId: null });
    }
  });

  routes.post(
    '/api/companies',
    { preHandler: guards.requireAuth, schema: { body: companyInput } },
    async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) throw new Error('requireAuth did not run');
      if (ctx.member) {
        return sendError(reply, 409, 'ALREADY_IN_COMPANY', 'Already a member of a company');
      }
      try {
        const created = await deps.createCompany({
          userId: ctx.userId,
          name: request.body.name,
          contactPhone: request.body.contactPhone ?? null,
        });
        return reply.status(201).send({ companyId: created.companyId });
      } catch (error) {
        if (error instanceof AlreadyInCompanyError) {
          return sendError(reply, 409, 'ALREADY_IN_COMPANY', 'Already a member of a company');
        }
        throw error;
      }
    },
  );

  routes.get(
    '/api/company',
    { preHandler: guards.requireCompany, schema: { response: { 200: company } } },
    async (request) => {
      const { member } = companyContext(request);
      const current = await withCompany(database, member.companyId, readCompany);
      if (!current) throw new Error('company of the current session not found');
      return current;
    },
  );

  // The company is always the session's; a company id in the body is rejected by the
  // strict schema and could not reach another company through RLS anyway.
  routes.patch(
    '/api/company',
    {
      preHandler: guards.requirePermission('company.update'),
      schema: { body: companyPatchInput, response: { 200: company } },
    },
    async (request) => {
      const { member } = companyContext(request);
      return withCompany(database, member.companyId, async (tx) => {
        const { company: updated, changed } = await updateCompany(
          tx,
          member.companyId,
          request.body,
        );
        if (changed.length > 0) {
          await recordAudit(tx, {
            actorMemberId: member.memberId,
            action: 'company.updated',
            targetType: 'company',
            targetId: member.companyId,
            fields: changed,
          });
        }
        return updated;
      });
    },
  );

  routes.get(
    '/api/members/:id',
    {
      preHandler: guards.requireCompany,
      schema: { params: z.object({ id: z.string() }), response: { 200: memberResponse } },
    },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!z.uuid().safeParse(id).success) return guards.notFound(request, reply, 'member', id);
      const [found] = await withCompany(database, member.companyId, (tx) =>
        tx
          .select({
            id: memberProfiles.id,
            name: memberProfiles.name,
            email: memberProfiles.email,
            role: memberProfiles.role,
            status: memberProfiles.status,
          })
          .from(memberProfiles)
          .where(eq(memberProfiles.id, id)),
      );
      if (!found) return guards.notFound(request, reply, 'member', id);
      return found;
    },
  );
}
