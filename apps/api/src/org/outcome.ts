import { type CompanyTx, type Database, withCompany } from '@dw/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuditWriter, companyContext, type Guards, sendError } from '../tenancy/index.ts';

/**
 * Result of an org service call. Services never write on failure, so the
 * transaction commits nothing; the route turns failures into responses and,
 * for `not_found` / `denied`, an AuditEvent written outside that transaction.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: 'not_found' }
  /** Missing permission (design D2): 403 + `access.denied`. */
  | { readonly ok: false; readonly kind: 'denied'; readonly code: string }
  /** A data rule (400 / 409 / 410 / 413 / 422) with its own code; no `access.denied`. */
  | {
      readonly ok: false;
      readonly kind: 'rejected';
      readonly status: 400 | 409 | 410 | 413 | 422;
      readonly code: string;
      readonly details?: unknown;
    };

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
export const notFound: Outcome<never> = { ok: false, kind: 'not_found' };
export const denied = (code: string): Outcome<never> => ({ ok: false, kind: 'denied', code });
export const rejected = (
  status: 400 | 409 | 410 | 413 | 422,
  code: string,
  details?: unknown,
): Outcome<never> => ({ ok: false, kind: 'rejected', status, code, details });

/** 400 naming one field, in the same shape as request validation errors. */
export const fieldError = (path: string, message: string): Outcome<never> =>
  rejected(400, 'VALIDATION_ERROR', [{ path, message }]);

type Failure = Exclude<Outcome<unknown>, { ok: true }>;

/** Sends the response for a failed outcome (404 / 403 with audit, or the rule's status). */
export async function sendFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: { guards: Guards; audit: AuditWriter },
  failure: Failure,
  target: { type: string; id: string },
) {
  if (failure.kind === 'not_found') {
    return deps.guards.notFound(request, reply, target.type, target.id);
  }
  if (failure.kind === 'denied') {
    const { member } = companyContext(request);
    await deps.audit(member.companyId, {
      actorMemberId: member.memberId,
      action: 'access.denied',
      targetType: target.type,
      targetId: target.id.slice(0, 100),
    });
    return sendError(reply, 403, failure.code, 'Not allowed');
  }
  const body =
    failure.details === undefined
      ? { error: { code: failure.code, message: failure.code } }
      : { error: { code: failure.code, message: failure.code, details: failure.details } };
  return reply.status(failure.status).send(body);
}

class RollbackOutcome extends Error {
  readonly outcome: Failure;
  constructor(outcome: Failure) {
    super('rollback');
    this.outcome = outcome;
  }
}

/**
 * Runs `fn` in `withCompany` and rolls the transaction back when it returns a
 * failed outcome, so a rule broken half-way never leaves a partial write.
 * `onError` maps database errors (e.g. unique violations) to outcomes.
 */
export async function companyOutcome<T>(
  database: Pick<Database, 'db'>,
  companyId: string,
  fn: (tx: CompanyTx) => Promise<Outcome<T>>,
  onError?: (error: unknown) => Outcome<never>,
): Promise<Outcome<T>> {
  try {
    return await withCompany(database, companyId, async (tx) => {
      const outcome = await fn(tx);
      if (!outcome.ok) throw new RollbackOutcome(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof RollbackOutcome) return error.outcome;
    if (onError) return onError(error);
    throw error;
  }
}
