import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth.ts';
import type { FailedLoginLimiter } from './failed-login-limiter.ts';

const SIGN_IN_EMAIL = '/api/auth/sign-in/email';

/** Mounts Better Auth on GET|POST /api/auth/* (better-auth 1.7 Fastify guide). */
export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; limiter: FailedLoginLimiter },
): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const path = request.url.split('?')[0];
      const email = path === SIGN_IN_EMAIL ? emailOf(request.body) : null;
      if (email && deps.limiter.isBlocked(email)) {
        return reply.status(429).send({
          error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-in attempts' },
        });
      }
      const response = await deps.auth.handler(toFetchRequest(request));
      if (email) {
        if (response.status === 401) deps.limiter.recordFailure(email);
        else if (response.ok) deps.limiter.reset(email);
      }
      return sendFetchResponse(reply, response);
    },
  });
}

function emailOf(body: unknown): string | null {
  const email = (body as { email?: unknown } | null)?.email;
  return typeof email === 'string' && email.trim() !== '' ? email : null;
}

export function toFetchRequest(request: FastifyRequest): Request {
  const url = new URL(request.url, `${request.protocol}://${request.host}`);
  const hasBody = request.method !== 'GET' && request.body !== undefined;
  return new Request(url, {
    method: request.method,
    headers: fromNodeHeaders(request.headers),
    ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
  });
}

export async function sendFetchResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status);
  for (const [key, value] of response.headers) {
    if (key !== 'set-cookie') reply.header(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  return reply.send(response.body ? await response.text() : null);
}
