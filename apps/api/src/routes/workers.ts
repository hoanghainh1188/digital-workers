import {
  extendProbationInput,
  promotionRequestInput,
  returnProposalInput,
  testersInput,
  transitionInput,
  WORKER_TEMPLATES,
  workerDepartmentInput,
  workerInput,
  workerListQuery,
  workerPatchInput,
} from '@dw/core';
import { type CompanyTx, withCompany } from '@dw/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { companyOutcome, denied, type Outcome, sendFailure } from '../org/outcome.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { companyContext } from '../tenancy/index.ts';
import {
  createWorker,
  extendProbation,
  listWorkers,
  moveWorker,
  patchWorker,
  proposePromotion,
  returnPromotion,
  setTesters,
  transitionWorker,
  workerActor,
  workerDetail,
  workerHistory,
  workerWriteError,
} from '../workers/index.ts';
import type { OrgRouteDeps } from './departments.ts';

const idParams = z.object({ id: z.string() });

/** Digital workers: profile and lifecycle (specs worker-profile, worker-lifecycle). */
export function registerWorkerRoutes(app: FastifyInstance, deps: OrgRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;

  /** Runs a worker write for `:id` and sends its outcome (404 / 403 with audit, or the rule). */
  async function respond<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    fn: (tx: CompanyTx, member: { memberId: string }) => Promise<Outcome<T>>,
    status = 200,
  ) {
    const { member } = companyContext(request);
    if (id !== 'new' && !isUuid(id)) return guards.notFound(request, reply, 'worker', id);
    const outcome = await companyOutcome(
      database,
      member.companyId,
      (tx) => fn(tx, member),
      workerWriteError,
    );
    if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'worker', id });
    return reply.status(status).send(outcome.value);
  }

  /** Read-only variant: no rollback needed, same failure handling. */
  async function read<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    fn: (
      tx: CompanyTx,
      actor: NonNullable<Awaited<ReturnType<typeof workerActor>>>,
    ) => Promise<Outcome<T>>,
  ) {
    const { member } = companyContext(request);
    if (id !== 'list' && !isUuid(id)) return guards.notFound(request, reply, 'worker', id);
    const outcome = await withCompany(database, member.companyId, async (tx) => {
      const actor = await workerActor(tx, member);
      return actor ? fn(tx, actor) : denied('FORBIDDEN');
    });
    if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'worker', id });
    return reply.send(outcome.value);
  }

  routes.get(
    '/api/worker-templates',
    { preHandler: guards.requirePermission('worker.create') },
    async () => ({ templates: WORKER_TEMPLATES }),
  );

  // Every member sees the org chart; the scope decides what (0.2 #047, #105).
  routes.get(
    '/api/workers',
    { preHandler: guards.requireCompany, schema: { querystring: workerListQuery } },
    async (request, reply) =>
      read(request, reply, 'list', async (tx, actor) => ({
        ok: true as const,
        value: await listWorkers(tx, actor, request.query, new Date()),
      })),
  );

  routes.post(
    '/api/workers',
    { preHandler: guards.requirePermission('worker.create'), schema: { body: workerInput } },
    async (request, reply) =>
      respond(request, reply, 'new', (tx, member) => createWorker(tx, member, request.body), 201),
  );

  routes.get(
    '/api/workers/:id',
    { preHandler: guards.requirePermission('worker.view'), schema: { params: idParams } },
    async (request, reply) =>
      read(request, reply, request.params.id, (tx, actor) =>
        workerDetail(tx, actor, request.params.id, new Date()),
      ),
  );

  routes.get(
    '/api/workers/:id/history',
    { preHandler: guards.requirePermission('worker.view'), schema: { params: idParams } },
    async (request, reply) =>
      read(request, reply, request.params.id, (tx, actor) =>
        workerHistory(tx, actor, request.params.id),
      ),
  );

  routes.patch(
    '/api/workers/:id',
    {
      preHandler: guards.requirePermission('worker.edit'),
      schema: { params: idParams, body: workerPatchInput },
    },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        patchWorker(tx, member, request.params.id, request.body),
      ),
  );

  routes.post(
    '/api/workers/:id/department',
    {
      preHandler: guards.requirePermission('org.manage'),
      schema: { params: idParams, body: workerDepartmentInput },
    },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        moveWorker(tx, member, request.params.id, request.body),
      ),
  );

  routes.put(
    '/api/workers/:id/testers',
    {
      preHandler: guards.requirePermission('worker.suspend'),
      schema: { params: idParams, body: testersInput },
    },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        setTesters(tx, member, request.params.id, request.body.memberIds),
      ),
  );

  // Who may do which event is decided per worker by the state machine (design D2), so
  // these routes only require a company; decideTransition answers 403 with an audit.
  routes.post(
    '/api/workers/:id/transitions',
    { preHandler: guards.requireCompany, schema: { params: idParams, body: transitionInput } },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        transitionWorker(tx, member, request.params.id, request.body, new Date()),
      ),
  );

  routes.post(
    '/api/workers/:id/promotion-request',
    {
      preHandler: guards.requireCompany,
      schema: { params: idParams, body: promotionRequestInput },
    },
    async (request, reply) =>
      respond(
        request,
        reply,
        request.params.id,
        (tx, member) => proposePromotion(tx, member, request.params.id, request.body.note),
        201,
      ),
  );

  routes.post(
    '/api/workers/:id/promotion-request/return',
    {
      preHandler: guards.requirePermission('worker.approve'),
      schema: { params: idParams, body: returnProposalInput },
    },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        returnPromotion(tx, member, request.params.id, request.body.reason),
      ),
  );

  routes.post(
    '/api/workers/:id/probation/extend',
    {
      preHandler: guards.requirePermission('worker.suspend'),
      schema: { params: idParams, body: extendProbationInput },
    },
    async (request, reply) =>
      respond(request, reply, request.params.id, (tx, member) =>
        extendProbation(tx, member, request.params.id, request.body.days),
      ),
  );
}
