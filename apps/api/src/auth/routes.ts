import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth.ts';

/**
 * Mounts Better Auth on GET|POST /api/auth/* (better-auth 1.7 Fastify guide).
 * Rate limits and password rules live in Better Auth hooks (auth.ts), keyed on its
 * normalised endpoint path, not on the raw URL.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: { auth: Auth }): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) =>
      sendFetchResponse(reply, await deps.auth.handler(toFetchRequest(request))),
  });
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
