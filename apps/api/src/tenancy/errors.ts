import type { FastifyReply } from 'fastify';

/** Same envelope as plugins/errors.ts. */
export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

export const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
