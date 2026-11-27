import { type Action, can } from '@dw/core';
import type { AuditEventInput } from '@dw/db';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { CompanyContext } from './context.ts';
import { NOT_FOUND_BODY, sendError } from './errors.ts';

/** Writes an AuditEvent into `companyId` (implemented with withCompany + recordAudit). */
export type AuditWriter = (companyId: string, event: AuditEventInput) => Promise<void>;

export type Guards = ReturnType<typeof createGuards>;

/** Route guards (design D5). Use them as `preHandler`; order: auth → company → permission. */
export function createGuards(deps: { audit: AuditWriter }) {
  const requireAuth: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!request.ctx) return sendError(reply, 401, 'UNAUTHENTICATED', 'Sign in required');
  };

  const requireCompany: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!request.ctx) return sendError(reply, 401, 'UNAUTHENTICATED', 'Sign in required');
    if (!request.ctx.member) return sendError(reply, 409, 'NO_COMPANY', 'Create a company first');
    if (request.ctx.member.status !== 'active') {
      return sendError(reply, 403, 'ACCOUNT_LOCKED', 'Account is locked');
    }
  };

  /** 403 + `access.denied` AuditEvent when the member's role lacks `action`. */
  const requirePermission = (action: Action): preHandlerAsyncHookHandler =>
    async function permission(request, reply) {
      await requireCompany.call(this, request, reply);
      if (reply.sent) return;
      const ctx = companyContext(request);
      if (can(ctx.member.role, action) === false) {
        await deps.audit(ctx.member.companyId, {
          actorMemberId: ctx.member.memberId,
          action: 'access.denied',
          targetType: 'action',
          targetId: action,
        });
        return sendError(reply, 403, 'FORBIDDEN', 'Not allowed');
      }
    };

  const requireVerifiedEmail: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!request.ctx) return sendError(reply, 401, 'UNAUTHENTICATED', 'Sign in required');
    if (!request.ctx.emailVerified) {
      return sendError(reply, 403, 'EMAIL_NOT_VERIFIED', 'Verify your email first');
    }
  };

  /**
   * 404 for an id that does not exist or belongs to another company — the two are
   * indistinguishable on purpose — plus an `access.not_found` AuditEvent in the
   * caller's company (spec tenant-isolation).
   */
  const notFound = async (
    request: FastifyRequest,
    reply: FastifyReply,
    targetType: string,
    id: string,
  ) => {
    const ctx = companyContext(request);
    await deps.audit(ctx.member.companyId, {
      actorMemberId: ctx.member.memberId,
      action: 'access.not_found',
      targetType,
      targetId: id.slice(0, 100),
    });
    return reply.status(404).send(NOT_FOUND_BODY);
  };

  return { requireAuth, requireCompany, requirePermission, requireVerifiedEmail, notFound };
}

/** The context of a request that passed `requireCompany`. Throws otherwise (programming error). */
export function companyContext(request: FastifyRequest): CompanyContext {
  const ctx = request.ctx;
  if (!ctx?.member) throw new Error('companyContext() used on a route without requireCompany');
  return ctx as CompanyContext;
}
