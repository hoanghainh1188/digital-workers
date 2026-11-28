import {
  acceptInvitationInput,
  describeError,
  invitationInput,
  invitationTokenInput,
  ROLES,
  type Role,
} from '@dw/core';
import { invitationByTokenHash, memberForUser, withCompany } from '@dw/db';
import { inviteTemplate, type Mailer } from '@dw/mail';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type Auth,
  markEmailVerified,
  normalizeEmail,
  signUpInvited,
  userIdByEmail,
} from '../auth/index.ts';
import {
  acceptInvitation,
  cancelInvitation,
  createInvitations,
  hashInvitationToken,
  invitationProblem,
  invitationWriteError,
  listInvitations,
  resendInvitation,
} from '../org/invitations.ts';
import { companyOutcome, sendFailure } from '../org/outcome.ts';
import { perIpLimit, type RequestLimit } from '../plugins/request-guards.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { companyContext, readCompany, sendError } from '../tenancy/index.ts';
import type { OrgRouteDeps } from './departments.ts';

export type InvitationRouteDeps = OrgRouteDeps & {
  readonly auth: Auth;
  readonly mailer: Mailer;
  readonly webOrigin: string;
  /** Per-IP limit on the public preview / accept endpoints (spec invitations). */
  readonly invitationLimit: RequestLimit;
};

const idParams = z.object({ id: z.string() });
const invitationRow = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  state: z.enum(['pending', 'expired']),
  expiresAt: z.date(),
  createdAt: z.date(),
});

type InviteMail = {
  to: string;
  token: string;
  companyName: string;
  inviterName: string;
  role: Role;
  departmentName: string | null;
};

/** Invitations (spec invitations, design D4). */
export function registerInvitationRoutes(app: FastifyInstance, deps: InvitationRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;
  const ipLimit = perIpLimit(deps.invitationLimit);

  // Not awaited; a failure is logged without the address (design D4).
  const sendInvite = (log: FastifyBaseLogger, mail: InviteMail) => {
    const url = `${deps.webOrigin}/invite#token=${encodeURIComponent(mail.token)}`;
    void deps.mailer
      .send({
        to: mail.to,
        ...inviteTemplate({
          companyName: mail.companyName,
          inviterName: mail.inviterName,
          role: mail.role,
          departmentName: mail.departmentName,
          url,
        }),
      })
      .catch((error: unknown) =>
        log.error({ error: describeError(error) }, 'invitation email failed'),
      );
  };

  routes.get(
    '/api/invitations',
    {
      preHandler: guards.requirePermission('org.manage'),
      schema: {
        querystring: z.object({ state: z.enum(['pending', 'expired']).optional() }),
        response: { 200: z.strictObject({ invitations: z.array(invitationRow) }) },
      },
    },
    async (request) => {
      const { member } = companyContext(request);
      const rows = await withCompany(database, member.companyId, (tx) =>
        listInvitations(tx, request.query.state),
      );
      return { invitations: rows };
    },
  );

  routes.post(
    '/api/invitations',
    {
      preHandler: [guards.requirePermission('org.manage'), guards.requireVerifiedEmail],
      schema: { body: invitationInput },
    },
    async (request, reply) => {
      const ctx = companyContext(request);
      const { member } = ctx;
      let companyName = '';
      const outcome = await companyOutcome(
        database,
        member.companyId,
        async (tx) => {
          companyName = (await readCompany(tx))?.name ?? '';
          return createInvitations(tx, member, request.body);
        },
        invitationWriteError,
      );
      if (!outcome.ok) {
        return sendFailure(request, reply, deps, outcome, {
          type: 'invitation',
          id: request.body.role,
        });
      }
      // Emails go out only after the transaction committed (design D4).
      for (const created of outcome.value.created) {
        sendInvite(request.log, {
          to: created.email,
          token: created.token,
          companyName,
          inviterName: ctx.name,
          role: request.body.role,
          departmentName: outcome.value.departmentName,
        });
      }
      return reply.status(201).send({
        invited: outcome.value.created.map(({ id, email }) => ({ id, email })),
        skipped: outcome.value.skipped,
      });
    },
  );

  routes.post(
    '/api/invitations/:id/resend',
    {
      preHandler: [guards.requirePermission('org.manage'), guards.requireVerifiedEmail],
      schema: { params: idParams },
    },
    async (request, reply) => {
      const ctx = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'invitation', id);
      let companyName = '';
      const outcome = await companyOutcome(
        database,
        ctx.member.companyId,
        async (tx) => {
          companyName = (await readCompany(tx))?.name ?? '';
          return resendInvitation(tx, ctx.member, id);
        },
        invitationWriteError,
      );
      if (!outcome.ok)
        return sendFailure(request, reply, deps, outcome, { type: 'invitation', id });
      sendInvite(request.log, {
        to: outcome.value.email,
        token: outcome.value.token,
        companyName,
        inviterName: ctx.name,
        role: outcome.value.role,
        departmentName: outcome.value.departmentName,
      });
      return { id };
    },
  );

  routes.post(
    '/api/invitations/:id/cancel',
    { preHandler: guards.requirePermission('org.manage'), schema: { params: idParams } },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'invitation', id);
      const outcome = await companyOutcome(database, member.companyId, (tx) =>
        cancelInvitation(tx, member, id),
      );
      if (!outcome.ok)
        return sendFailure(request, reply, deps, outcome, { type: 'invitation', id });
      return outcome.value;
    },
  );

  // ── Public: the visitor has the link but no company yet (design D4) ─────────
  // POST, so the token travels in the body and never in a URL or access log.

  routes.post(
    '/api/invitations/preview',
    { preHandler: ipLimit, schema: { body: invitationTokenInput } },
    async (request, reply) => {
      const found = await invitationByTokenHash(database, hashInvitationToken(request.body.token));
      const problem = invitationProblem(found);
      // Expired / invalid reveal no company information (spec invitations).
      if (problem || !found) return sendError(reply, 410, problem ?? 'INVITATION_INVALID', 'Gone');
      return {
        companyName: found.companyName,
        inviterName: found.inviterName,
        email: found.email,
        role: found.role,
        departmentName: found.departmentName,
        expiresAt: found.expiresAt,
      };
    },
  );

  routes.post(
    '/api/invitations/accept',
    { preHandler: ipLimit, schema: { body: acceptInvitationInput } },
    async (request, reply) => {
      const { token, name, password } = request.body;
      const found = await invitationByTokenHash(database, hashInvitationToken(token));
      const problem = invitationProblem(found);
      if (problem || !found) return sendError(reply, 410, problem ?? 'INVITATION_INVALID', 'Gone');

      let userId: string;
      const ctx = request.ctx;
      if (ctx) {
        // Signed in (Google, or an account without a company): the session's email
        // must be the invited one; no password needed (0.2 #066).
        if (ctx.member) return sendError(reply, 409, 'ALREADY_IN_COMPANY', 'Already in a company');
        if (normalizeEmail(ctx.email) !== found.email) {
          return sendError(
            reply,
            403,
            'INVITATION_EMAIL_MISMATCH',
            'Invitation is for another email',
          );
        }
        userId = ctx.userId;
        await markEmailVerified(database, userId);
      } else {
        if (name === undefined || password === undefined) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request',
              details: [
                { path: 'name', message: 'required' },
                { path: 'password', message: 'required' },
              ],
            },
          });
        }
        const existing = await userIdByEmail(database, found.email);
        if (existing) {
          // One email = one company (0.2 #035). The holder of the token owns this
          // inbox, so saying which case applies reveals nothing new to them.
          const elsewhere = await memberForUser(database, existing);
          return elsewhere
            ? sendError(reply, 409, 'ALREADY_IN_COMPANY', 'Email belongs to another company')
            : sendError(
                reply,
                409,
                'EMAIL_TAKEN',
                'Sign in with that account, then reopen the link',
              );
        }
        const account = await signUpInvited(
          deps.auth,
          database,
          { name, email: found.email, password },
          request.headers,
        );
        if (!account.ok) {
          return account.code.includes('ALREADY_EXISTS')
            ? sendError(reply, 409, 'EMAIL_TAKEN', 'Email already has an account')
            : sendError(reply, Math.max(account.status, 400), account.code, 'Sign-up failed');
        }
        // Signed in from here on: if the next step fails, the web retries signed in.
        reply.header('set-cookie', [...account.setCookies]);
        userId = account.userId;
      }

      const outcome = await companyOutcome(
        database,
        found.companyId,
        (tx) => acceptInvitation(tx, found.id, userId),
        invitationWriteError,
      );
      if (!outcome.ok) {
        if (outcome.kind !== 'rejected') throw new Error('unexpected outcome accepting invitation');
        return sendError(reply, outcome.status, outcome.code, outcome.code);
      }
      return reply.status(201).send({ companyId: found.companyId });
    },
  );
}
