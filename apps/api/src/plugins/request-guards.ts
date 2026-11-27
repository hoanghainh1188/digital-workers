import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../tenancy/errors.ts';

/**
 * CSRF defence for our own state-changing routes (Better Auth checks /api/auth/*
 * itself): a POST / PATCH / PUT / DELETE under /api/ must carry an Origin header
 * from `trustedOrigins`. Browsers always send Origin on such fetches.
 */
export function registerOriginCheck(app: FastifyInstance, trustedOrigins: readonly string[]): void {
  const trusted = new Set(trustedOrigins);
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return;
    const origin = request.headers.origin;
    if (!origin || !trusted.has(origin)) {
      return sendError(reply, 403, 'INVALID_ORIGIN', 'Request origin not allowed');
    }
  });
}

export type RequestLimit = { readonly max: number; readonly windowMs: number };

/** Fixed-window per-IP limit as a preHandler (sign-up and company creation). */
export function perIpLimit(limit: RequestLimit, now: () => number = Date.now) {
  const windows = new Map<string, { count: number; endsAt: number }>();
  return async function ipLimit(request: FastifyRequest, reply: FastifyReply) {
    const time = now();
    if (windows.size > 50_000) {
      for (const [key, entry] of windows) if (entry.endsAt <= time) windows.delete(key);
    }
    const current = windows.get(request.ip);
    const entry =
      current && current.endsAt > time
        ? { count: current.count + 1, endsAt: current.endsAt }
        : { count: 1, endsAt: time + limit.windowMs };
    windows.set(request.ip, entry);
    if (entry.count > limit.max) {
      reply.header('retry-after', Math.ceil((entry.endsAt - time) / 1000));
      return sendError(reply, 429, 'TOO_MANY_REQUESTS', 'Too many requests');
    }
  };
}
