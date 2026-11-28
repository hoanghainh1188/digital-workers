import {
  approveVersionInput,
  assignSkillInput,
  createSkillInput,
  rejectVersionInput,
  rollbackInput,
  saveDraftInput,
  skillListQuery,
  submitDraftInput,
  versionNumberParam,
} from '@dw/core';
import { type CompanyTx, withCompany } from '@dw/db';
import { MAX_ZIP_BYTES, SKILL_MD } from '@dw/skills';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { companyOutcome, denied, type Outcome, sendFailure } from '../org/outcome.ts';
import { perIpLimit } from '../plugins/request-guards.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import {
  approveVersion,
  archiveSkill,
  assignSkill,
  createSkill,
  decideRequest,
  deleteDraftFile,
  downloadFile,
  exportSkill,
  importSkill,
  listSkills,
  listTemplates,
  putDraftFile,
  rejectVersion,
  removeSkill,
  rollbackSkill,
  SKILL_ERRORS,
  saveDraft,
  skillDetail,
  skillWriteError,
  submitDraft,
  useTemplate,
  versionView,
  workerSkillList,
} from '../skills/index.ts';
import { companyContext } from '../tenancy/index.ts';
import { type FreshActor, workerActor } from '../workers/people.ts';
import type { OrgRouteDeps } from './departments.ts';

const idParams = z.object({ id: z.string() });
const versionParams = z.object({ id: z.string(), n: versionNumberParam });
const fileParams = z.object({ id: z.string(), n: versionNumberParam, '*': z.string() });
const draftFileParams = z.object({ id: z.string(), '*': z.string() });
const workerSkillParams = z.object({ id: z.string(), skillId: z.string() });
const nameParams = z.object({ name: z.string().max(64) });
const revisionQuery = z.object({
  revision: z.coerce.number().int().min(0).optional(),
});
const importQuery = z.object({
  dryRun: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((value) => value === '1' || value === 'true'),
});
const exportQuery = z.object({ version: versionNumberParam.optional() });

/** Imports per IP per minute (task 5.1): unpacking a zip costs CPU. */
const IMPORT_LIMIT = { max: 30, windowMs: 60_000 } as const;
const RAW_TYPES = ['application/zip', 'application/octet-stream'];

const toBytes = (body: unknown): Uint8Array =>
  Buffer.isBuffer(body)
    ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    : new Uint8Array(0);

/** Attachment headers: never rendered by the browser as a page of the platform (D6). */
function sendAttachment(
  reply: FastifyReply,
  filename: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'file';
  return reply
    .header('content-type', mediaType)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('cache-control', 'private, no-store')
    .header(
      'content-disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** Skill library, packages and worker skills (specs skill-library, skill-package, worker-skills). */
export function registerSkillRoutes(app: FastifyInstance, deps: OrgRouteDeps): void {
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;

  async function write<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    target: { type: 'skill' | 'worker'; id: string },
    fn: (tx: CompanyTx, actor: FreshActor) => Promise<Outcome<T>>,
    status = 200,
  ) {
    const { member } = companyContext(request);
    if (target.id !== 'new' && !isUuid(target.id)) {
      return guards.notFound(request, reply, target.type, target.id);
    }
    const outcome = await companyOutcome(
      database,
      member.companyId,
      async (tx) => {
        const actor = await workerActor(tx, member);
        return actor ? fn(tx, actor) : denied('FORBIDDEN');
      },
      skillWriteError,
    );
    if (!outcome.ok) return sendFailure(request, reply, deps, outcome, target);
    return reply.status(status).send(outcome.value);
  }

  /** Reads still go through companyOutcome: export writes its AuditEvent. */
  const read = write;

  app.register(async (scope) => {
    const routes = scope.withTypeProvider<ZodTypeProvider>();

    // ── Library ────────────────────────────────────────────────────────────
    routes.get(
      '/api/skills',
      { preHandler: guards.requireCompany, schema: { querystring: skillListQuery } },
      async (request) => {
        const { member } = companyContext(request);
        return withCompany(database, member.companyId, (tx) => listSkills(tx, request.query));
      },
    );

    routes.post(
      '/api/skills',
      { preHandler: guards.requirePermission('skill.edit'), schema: { body: createSkillInput } },
      async (request, reply) =>
        write(
          request,
          reply,
          { type: 'skill', id: 'new' },
          (tx, actor) =>
            createSkill(
              tx,
              actor,
              [{ path: SKILL_MD, bytes: new TextEncoder().encode(request.body.skillMd) }],
              'skill.created',
            ),
          201,
        ),
    );

    routes.get(
      '/api/skills/:id',
      { preHandler: guards.requireCompany, schema: { params: idParams } },
      async (request, reply) =>
        read(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          skillDetail(tx, actor, request.params.id),
        ),
    );

    routes.get(
      '/api/skills/:id/versions/:n',
      { preHandler: guards.requireCompany, schema: { params: versionParams } },
      async (request, reply) =>
        read(request, reply, { type: 'skill', id: request.params.id }, (tx) =>
          versionView(tx, request.params.id, request.params.n),
        ),
    );

    // ── Draft and review ───────────────────────────────────────────────────
    routes.put(
      '/api/skills/:id/draft',
      {
        preHandler: guards.requirePermission('skill.edit'),
        schema: { params: idParams, body: saveDraftInput },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          saveDraft(tx, actor, request.params.id, request.body),
        ),
    );

    routes.post(
      '/api/skills/:id/draft/submit',
      {
        preHandler: guards.requirePermission('skill.edit'),
        schema: { params: idParams, body: submitDraftInput },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          submitDraft(tx, actor, request.params.id, request.body),
        ),
    );

    routes.post(
      '/api/skills/:id/versions/:n/approve',
      {
        preHandler: guards.requirePermission('skill.approve'),
        schema: { params: versionParams, body: approveVersionInput },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          approveVersion(tx, actor, request.params.id, request.params.n, request.body.risk),
        ),
    );

    routes.post(
      '/api/skills/:id/versions/:n/reject',
      {
        preHandler: guards.requirePermission('skill.approve'),
        schema: { params: versionParams, body: rejectVersionInput },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          rejectVersion(tx, actor, request.params.id, request.params.n, request.body.reason),
        ),
    );

    routes.post(
      '/api/skills/:id/rollback',
      {
        preHandler: guards.requirePermission('skill.approve'),
        schema: { params: idParams, body: rollbackInput },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          rollbackSkill(tx, actor, request.params.id, request.body.versionNumber),
        ),
    );

    routes.post(
      '/api/skills/:id/archive',
      { preHandler: guards.requirePermission('skill.approve'), schema: { params: idParams } },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          archiveSkill(tx, actor, request.params.id),
        ),
    );

    // ── Export and files ───────────────────────────────────────────────────
    async function sendExport(
      request: FastifyRequest,
      reply: FastifyReply,
      id: string,
      number: number | null,
    ) {
      const { member } = companyContext(request);
      if (!isUuid(id)) return guards.notFound(request, reply, 'skill', id);
      const outcome = await companyOutcome(database, member.companyId, (tx) =>
        exportSkill(tx, member, id, number),
      );
      if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'skill', id });
      return sendAttachment(reply, outcome.value.filename, 'application/zip', outcome.value.bytes);
    }

    routes.get(
      '/api/skills/:id/export',
      { preHandler: guards.requireCompany, schema: { params: idParams, querystring: exportQuery } },
      async (request, reply) =>
        sendExport(request, reply, request.params.id, request.query.version ?? null),
    );

    routes.get(
      '/api/skills/:id/versions/:n/export',
      { preHandler: guards.requireCompany, schema: { params: versionParams } },
      async (request, reply) => sendExport(request, reply, request.params.id, request.params.n),
    );

    routes.get(
      '/api/skills/:id/versions/:n/files/*',
      { preHandler: guards.requireCompany, schema: { params: fileParams } },
      async (request, reply) => {
        const { member } = companyContext(request);
        const { id, n } = request.params;
        if (!isUuid(id)) return guards.notFound(request, reply, 'skill', id);
        const outcome = await withCompany(database, member.companyId, (tx) =>
          downloadFile(tx, id, n, request.params['*']),
        );
        if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'skill', id });
        const file = outcome.value;
        return sendAttachment(reply, file.filename, file.mediaType, file.bytes);
      },
    );

    // ── Templates ──────────────────────────────────────────────────────────
    routes.get('/api/skill-templates', { preHandler: guards.requireCompany }, async () =>
      listTemplates(),
    );

    routes.post(
      '/api/skill-templates/:name/use',
      { preHandler: guards.requirePermission('skill.edit'), schema: { params: nameParams } },
      async (request, reply) =>
        write(
          request,
          reply,
          { type: 'skill', id: 'new' },
          (tx, actor) => useTemplate(tx, actor, request.params.name),
          201,
        ),
    );

    // ── Worker skills ──────────────────────────────────────────────────────
    routes.get(
      '/api/workers/:id/skills',
      { preHandler: guards.requirePermission('worker.view'), schema: { params: idParams } },
      async (request, reply) =>
        read(request, reply, { type: 'worker', id: request.params.id }, (tx, actor) =>
          workerSkillList(tx, actor, request.params.id),
        ),
    );

    routes.post(
      '/api/workers/:id/skills',
      {
        preHandler: guards.requirePermission('skill.assign'),
        schema: { params: idParams, body: assignSkillInput },
      },
      async (request, reply) =>
        write(
          request,
          reply,
          { type: 'worker', id: request.params.id },
          (tx, actor) => assignSkill(tx, actor, request.params.id, request.body.skillId),
          201,
        ),
    );

    routes.delete(
      '/api/workers/:id/skills/:skillId',
      {
        preHandler: guards.requirePermission('skill.assign'),
        schema: { params: workerSkillParams },
      },
      async (request, reply) => {
        if (!isUuid(request.params.skillId)) {
          return guards.notFound(request, reply, 'skill', request.params.skillId);
        }
        return write(request, reply, { type: 'worker', id: request.params.id }, (tx, actor) =>
          removeSkill(tx, actor, request.params.id, request.params.skillId),
        );
      },
    );

    for (const decision of ['approve', 'reject'] as const) {
      routes.post(
        `/api/workers/:id/skills/:skillId/${decision}`,
        {
          preHandler: guards.requirePermission('skill.approve'),
          schema: { params: workerSkillParams },
        },
        async (request, reply) => {
          if (!isUuid(request.params.skillId)) {
            return guards.notFound(request, reply, 'skill', request.params.skillId);
          }
          return write(request, reply, { type: 'worker', id: request.params.id }, (tx, actor) =>
            decideRequest(tx, actor, request.params.id, request.params.skillId, decision),
          );
        },
      );
    }
  });

  // ── Raw bodies: only the import and draft-file routes accept them (task 5.1) ──
  app.register(async (scope) => {
    const routes = scope.withTypeProvider<ZodTypeProvider>();
    scope.addContentTypeParser(
      RAW_TYPES,
      { parseAs: 'buffer', bodyLimit: MAX_ZIP_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.setErrorHandler<FastifyError>((error, _request, reply) => {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply.status(413).send({
          error: {
            code: SKILL_ERRORS.packageTooLarge,
            message: SKILL_ERRORS.packageTooLarge,
            details: { max: MAX_ZIP_BYTES },
          },
        });
      }
      throw error;
    });
    const ipLimit = perIpLimit(IMPORT_LIMIT);

    routes.post(
      '/api/skills/import',
      {
        bodyLimit: MAX_ZIP_BYTES,
        preHandler: [guards.requirePermission('skill.edit'), ipLimit],
        schema: { querystring: importQuery },
      },
      async (request, reply) =>
        write(
          request,
          reply,
          { type: 'skill', id: 'new' },
          (tx, actor) => importSkill(tx, actor, toBytes(request.body), request.query.dryRun),
          request.query.dryRun ? 200 : 201,
        ),
    );

    routes.put(
      '/api/skills/:id/draft/files/*',
      {
        bodyLimit: MAX_ZIP_BYTES,
        preHandler: guards.requirePermission('skill.edit'),
        schema: { params: draftFileParams, querystring: revisionQuery },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          putDraftFile(tx, actor, request.params.id, {
            path: request.params['*'],
            bytes: toBytes(request.body),
            revision: request.query.revision ?? null,
          }),
        ),
    );

    routes.delete(
      '/api/skills/:id/draft/files/*',
      {
        preHandler: guards.requirePermission('skill.edit'),
        schema: { params: draftFileParams, querystring: revisionQuery },
      },
      async (request, reply) =>
        write(request, reply, { type: 'skill', id: request.params.id }, (tx, actor) =>
          deleteDraftFile(tx, actor, request.params.id, {
            path: request.params['*'],
            revision: request.query.revision ?? null,
          }),
        ),
    );
  });
}
