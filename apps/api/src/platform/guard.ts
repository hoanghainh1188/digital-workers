import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { RequestContext } from '../tenancy/context.ts';
import { NOT_FOUND_BODY, sendError } from '../tenancy/errors.ts';
import type { AuditWriter } from '../tenancy/guards.ts';

/** Platform admin rights of a session end 12 hours after sign-in (0.2 #100). */
export const PLATFORM_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

export type PlatformAdminContext = RequestContext & { readonly member: null };

export type PlatformGuardDeps = {
  readonly audit: AuditWriter;
  readonly isPlatformAdmin: (email: string) => boolean;
  readonly now?: () => Date;
};

declare module 'fastify' {
  interface FastifyRequest {
    platformAdmin: PlatformAdminContext | null;
  }
}

/**
 * `onRequest` guard for /api/platform/* (design D10). It runs before body and params
 * validation, so an outsider gets the same 404 as for a path that does not exist,
 * whatever they send. In order:
 *   1. a session, an email in PLATFORM_ADMIN_EMAILS, verified, no company → else 404
 *      (plus `access.not_found` in the caller's company when they have one);
 *   2. TOTP enabled → else 403 TWO_FACTOR_REQUIRED;
 *   3. signed in less than 12 hours ago → else 401 REAUTH_REQUIRED.
 */
export function createPlatformGuard(deps: PlatformGuardDeps): onRequestAsyncHookHandler {
  const now = deps.now ?? (() => new Date());
  return async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
    const ctx = request.ctx;
    const isAdmin =
      ctx !== null && ctx.member === null && ctx.emailVerified && deps.isPlatformAdmin(ctx.email);
    if (!isAdmin) {
      if (ctx?.member) {
        await deps.audit(ctx.member.companyId, {
          actorMemberId: ctx.member.memberId,
          action: 'access.not_found',
          targetType: 'platform',
          targetId: (request.url.split('?')[0] ?? '').slice(0, 100),
        });
      }
      return reply.status(404).send(NOT_FOUND_BODY);
    }
    if (!ctx.twoFactorEnabled) {
      return sendError(reply, 403, 'TWO_FACTOR_REQUIRED', 'Turn on two-step verification first');
    }
    if (now().getTime() - ctx.sessionCreatedAt.getTime() > PLATFORM_SESSION_MAX_MS) {
      return sendError(reply, 401, 'REAUTH_REQUIRED', 'Sign in again');
    }
    request.platformAdmin = ctx as PlatformAdminContext;
  };
}

/** The admin of a request that passed the guard. Throws otherwise (programming error). */
export function platformAdmin(request: FastifyRequest): PlatformAdminContext {
  if (!request.platformAdmin) throw new Error('platformAdmin() used without the platform guard');
  return request.platformAdmin;
}
