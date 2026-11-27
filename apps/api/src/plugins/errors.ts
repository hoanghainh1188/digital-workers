import type { FastifyError, FastifyInstance } from 'fastify';
import { RequestValidationError } from './zod.ts';

export type ErrorEnvelope = {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
};

/** One envelope for every error. 5xx responses never reveal internals; details go to the log. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof RequestValidationError) {
      return reply.status(400).send(envelope(error.code, error.message, error.issues));
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ error: { message: error.message, code: error.code } }, 'request failed');
      return reply.status(status).send(envelope('INTERNAL_ERROR', 'Internal server error'));
    }
    return reply.status(status).send(envelope(error.code ?? 'REQUEST_ERROR', error.message));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(envelope('NOT_FOUND', 'Not found')),
  );
}

function envelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
