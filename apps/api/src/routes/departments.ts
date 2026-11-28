import { can, departmentInput, departmentPatchInput } from '@dw/core';
import { type Database, withCompany } from '@dw/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  archiveDepartment,
  createDepartment,
  departmentWriteError,
  listDepartments,
  updateDepartment,
} from '../org/departments.ts';
import { companyOutcome, sendFailure } from '../org/outcome.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { type AuditWriter, companyContext, type Guards } from '../tenancy/index.ts';

export type OrgRouteDeps = {
  readonly database: Database;
  readonly guards: Guards;
  readonly audit: AuditWriter;
};

const idParams = z.object({ id: z.string() });
const person = z.strictObject({ id: z.uuid(), name: z.string() });
const departmentView = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  head: person.nullable(),
  memberCount: z.number().int(),
  members: z.array(person),
});
const listResponse = z.strictObject({
  departments: z.array(departmentView),
  unassignedCount: z.number().int().nullable(),
});

/** Departments (spec departments, design D5 / D9). */
export function registerDepartmentRoutes(app: FastifyInstance, deps: OrgRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const isUuid = (id: string) => z.uuid().safeParse(id).success;

  // Every active member may see the departments (0.2 #068); no matrix row needed.
  routes.get(
    '/api/departments',
    { preHandler: guards.requireCompany, schema: { response: { 200: listResponse } } },
    async (request) => {
      const { member } = companyContext(request);
      const manages = can(member.role, 'org.manage') !== false;
      return withCompany(database, member.companyId, (tx) => listDepartments(tx, manages));
    },
  );

  routes.post(
    '/api/departments',
    { preHandler: guards.requirePermission('org.manage'), schema: { body: departmentInput } },
    async (request, reply) => {
      const { member } = companyContext(request);
      const outcome = await companyOutcome(
        database,
        member.companyId,
        (tx) => createDepartment(tx, member, request.body),
        departmentWriteError,
      );
      if (!outcome.ok) {
        return sendFailure(request, reply, deps, outcome, {
          type: 'member',
          id: request.body.headMemberId ?? '',
        });
      }
      return reply.status(201).send(outcome.value);
    },
  );

  routes.patch(
    '/api/departments/:id',
    {
      preHandler: guards.requirePermission('org.manage'),
      schema: { params: idParams, body: departmentPatchInput },
    },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'department', id);
      const outcome = await companyOutcome(
        database,
        member.companyId,
        (tx) => updateDepartment(tx, member, id, request.body),
        departmentWriteError,
      );
      if (!outcome.ok)
        return sendFailure(request, reply, deps, outcome, { type: 'department', id });
      return outcome.value;
    },
  );

  routes.post(
    '/api/departments/:id/archive',
    { preHandler: guards.requirePermission('org.manage'), schema: { params: idParams } },
    async (request, reply) => {
      const { member } = companyContext(request);
      const { id } = request.params;
      if (!isUuid(id)) return guards.notFound(request, reply, 'department', id);
      const outcome = await companyOutcome(database, member.companyId, (tx) =>
        archiveDepartment(tx, member, id),
      );
      if (!outcome.ok)
        return sendFailure(request, reply, deps, outcome, { type: 'department', id });
      return outcome.value;
    },
  );
}
