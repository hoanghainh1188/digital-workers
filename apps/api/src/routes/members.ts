import { describeError, memberPatchInput, ROLES } from '@dw/core';
import { withCompany } from '@dw/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { revokeUserSessions } from '../auth/index.ts';
import {
  listMembers,
  lockMember,
  memberWriteError,
  patchMember,
  unlockMember,
} from '../org/members.ts';
import { companyOutcome, sendFailure } from '../org/outcome.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { companyContext } from '../tenancy/index.ts';
import type { OrgRouteDeps } from './departments.ts';

const idParams = z.object({ id: z.string() });

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);
const listQuery = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  role: z.preprocess(blankToUndefined, z.enum(ROLES).optional()),
  department: z.preprocess(blankToUndefined, z.union([z.uuid(), z.literal('none')]).optional()),
  status: z.preprocess(blankToUndefined, z.enum(['active', 'locked']).optional()),
});

const memberRow = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(['active', 'locked']),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  lockedAt: z.date().nullable(),
  lastSeenAt: z.date().nullable(),
  createdAt: z.date(),
});

/** People in the company (spec member-management, design D6). */
export function registerMemberRoutes(app: FastifyInstance, deps: OrgRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;

  routes.get(
    '/api/members',
    {
      preHandler: guards.requirePermission('member.list'),
      schema: {
        querystring: listQuery,
        response: { 200: z.strictObject({ members: z.array(memberRow) }) },
      },
    },
    async (request) => {
      const { member } = companyContext(request);
      const rows = await withCompany(database, member.companyId, (tx) =>
        listMembers(tx, member, request.query),
      );
      return { members: rows };
    },
  );

  routes.patch(
    '/api/members/:id',
    {
      preHandler: guards.requirePermission('org.manage'),
      schema: { params: idParams, body: memberPatchInput },
    },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'member', id);
      const outcome = await companyOutcome(
        database,
        member.companyId,
        (tx) => patchMember(tx, member, id, request.body),
        memberWriteError,
      );
      if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'member', id });
      return outcome.value;
    },
  );

  routes.post(
    '/api/members/:id/lock',
    { preHandler: guards.requirePermission('org.manage'), schema: { params: idParams } },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'member', id);
      const outcome = await companyOutcome(database, member.companyId, (tx) =>
        lockMember(tx, member, id),
      );
      if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'member', id });
      // After commit. If this fails, requireCompany still refuses the locked member.
      await revokeUserSessions(database, outcome.value.userId).catch((error: unknown) =>
        request.log.error({ error: describeError(error) }, 'revoking sessions after lock failed'),
      );
      return { id, status: 'locked' as const };
    },
  );

  routes.post(
    '/api/members/:id/unlock',
    { preHandler: guards.requirePermission('org.manage'), schema: { params: idParams } },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'member', id);
      const outcome = await companyOutcome(database, member.companyId, (tx) =>
        unlockMember(tx, member, id),
      );
      if (!outcome.ok) return sendFailure(request, reply, deps, outcome, { type: 'member', id });
      return { id, status: 'active' as const };
    },
  );
}
