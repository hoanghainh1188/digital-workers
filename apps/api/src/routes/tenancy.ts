import { isExhausted } from '@dw/billing';
import { companyInput, companyPatchInput, describeError, signupInput } from '@dw/core';
import { type Database, memberProfiles, recordAudit, withCompany } from '@dw/db';
import { eq } from '@dw/db/drizzle';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Auth, signUpWithEmail } from '../auth/index.ts';
import { perIpLimit, type RequestLimit } from '../plugins/request-guards.ts';
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
  readonly signupLimit: RequestLimit;
  readonly auth: Auth;
  readonly database: Database;
  readonly guards: Guards;
  readonly createCompany: CreateCompany;
  readonly googleEnabled: boolean;
  /** Email in PLATFORM_ADMIN_EMAILS (design D10): such accounts never get a company. */
  readonly isPlatformAdmin: (email: string) => boolean;
};

/** Roles that see the "hết credit" banner (spec credit-ledger "Báo hết credit trên mọi trang"). */
const CREDIT_BANNER_ROLES = new Set(['owner', 'admin', 'manager']);

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
  /** Owner / Admin / Trưởng phòng only; Nhân viên never get it. No balance here. */
  credit: z.strictObject({ exhausted: z.boolean() }).optional(),
  /** Only for a platform admin (no company): where to go next. */
  platformAdmin: z.strictObject({ twoFactorEnabled: z.boolean() }).optional(),
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
  // Sign-up bypasses Better Auth's router (and its IP limit), so it gets its own.
  const ipLimit = perIpLimit(deps.signupLimit);

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
      const member = ctx.member;
      const [current, exhausted] = member
        ? await withCompany(
            database,
            member.companyId,
            async (tx) =>
              [
                await readCompany(tx),
                CREDIT_BANNER_ROLES.has(member.role) ? await isExhausted(tx) : null,
              ] as const,
          )
        : [null, null];
      return {
        user: {
          id: ctx.userId,
          name: ctx.name,
          email: ctx.email,
          emailVerified: ctx.emailVerified,
        },
        member: ctx.member ? { id: ctx.member.memberId, role: ctx.member.role } : null,
        company: current,
        ...(exhausted === null ? {} : { credit: { exhausted } }),
        ...(!ctx.member && deps.isPlatformAdmin(ctx.email)
          ? { platformAdmin: { twoFactorEnabled: ctx.twoFactorEnabled } }
          : {}),
      };
    },
  );

  // Email signup = Better Auth account, then company + Owner (design D4). If the
  // second step fails the user is signed in without a company → /onboarding.
  routes.post(
    '/api/signup',
    { preHandler: ipLimit, schema: { body: signupInput } },
    async (request, reply) => {
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
      // A platform admin gets the account (signed in, verification email sent) but
      // never a company (spec platform-admin "Platform admin tạo công ty").
      if (deps.isPlatformAdmin(input.email)) {
        return reply.status(201).send({ companyId: null, platformAdmin: true });
      }
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
    },
  );

  routes.post(
    '/api/companies',
    { preHandler: [ipLimit, guards.requireAuth], schema: { body: companyInput } },
    async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) throw new Error('requireAuth did not run');
      if (ctx.member) {
        return sendError(reply, 409, 'ALREADY_IN_COMPANY', 'Already a member of a company');
      }
      if (deps.isPlatformAdmin(ctx.email)) {
        return sendError(reply, 409, 'PLATFORM_ADMIN', 'Platform admins cannot create a company');
      }
      try {
        const created = await deps.createCompany({
          userId: ctx.userId,
          name: request.body.name,
          contactPhone: request.body.contactPhone ?? null,
          emailVerified: ctx.emailVerified,
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
