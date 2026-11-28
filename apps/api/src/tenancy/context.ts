import type { MemberForUser } from '@dw/db';
import type { FastifyInstance } from 'fastify';

/** Who is calling, resolved once per request from the session (design D5). */
export type RequestContext = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly sessionCreatedAt: Date;
  /** Null until the user has created or joined a company. */
  readonly member: MemberForUser | null;
};

/** A request that passed `requireCompany`. */
export type CompanyContext = RequestContext & { readonly member: MemberForUser };

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
}

export type ContextResolver = (
  headers: import('node:http').IncomingHttpHeaders,
) => Promise<RequestContext | null>;

/**
 * Plugin `request-context`: fills `request.ctx` for /api routes. Better Auth's own
 * routes (/api/auth/*) handle sessions themselves and are skipped.
 */
export function registerRequestContext(app: FastifyInstance, resolve: ContextResolver): void {
  app.decorateRequest('ctx', null);
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return;
    request.ctx = await resolve(request.headers);
  });
}
