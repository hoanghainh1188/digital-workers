import type { FastifyInstance } from 'fastify';
import type { Harness, TestApp } from './harness.ts';
import { addPerson, call, createDepartment, type OrgTenant, type Person, sqlIn } from './org.ts';

/** `seedOrg` plus a "Kế toán" department with its own Manager and Member. */
export type WorkerTenant = OrgTenant & {
  readonly accountingId: string;
  readonly accountingManager: Person;
  readonly accountingMember: Person;
};

export async function addAccounting(
  t: TestApp,
  harness: Harness,
  org: OrgTenant,
): Promise<WorkerTenant> {
  const accountingId = await createDepartment(t.app, org.owner.cookie, 'Kế toán');
  const accountingManager = await addPerson(
    t,
    harness,
    org.companyId,
    'manager',
    accountingId,
    'Phạm Thu Hà',
  );
  const accountingMember = await addPerson(
    t,
    harness,
    org.companyId,
    'member',
    accountingId,
    'Đỗ Văn Nam',
  );
  return { ...org, accountingId, accountingManager, accountingMember };
}

let counter = 0;
/** A unique worker name (names are unique per company among live workers). */
export function workerName(label = 'Minh · Báo giá'): string {
  counter += 1;
  return `${label} ${counter}`;
}

/** Creates a draft through the API and returns its id. */
export async function newWorker(
  app: FastifyInstance,
  cookie: string,
  departmentId: string,
  options: { name?: string; templateId?: string | null } = {},
): Promise<string> {
  const res = await call(app, 'POST', '/api/workers', cookie, {
    name: options.name ?? workerName(),
    departmentId,
    templateId: options.templateId === undefined ? 'quote-assistant' : options.templateId,
  });
  if (res.statusCode !== 201) throw new Error(`worker: ${res.statusCode} ${res.body}`);
  return res.json().id as string;
}

export function detail(app: FastifyInstance, cookie: string, id: string) {
  return call(app, 'GET', `/api/workers/${id}`, cookie);
}

export function transition(
  app: FastifyInstance,
  cookie: string,
  id: string,
  event: string,
  expectedStatus: string,
  extra: Record<string, unknown> = {},
) {
  return call(app, 'POST', `/api/workers/${id}/transitions`, cookie, {
    event,
    expectedStatus,
    ...extra,
  });
}

/** Moves a worker straight to `status` through the API as Owner. */
export async function workerIn(
  t: TestApp,
  org: OrgTenant,
  status: 'draft' | 'probation' | 'active' | 'suspended' | 'offboarded',
  departmentId = org.departmentId,
  name = workerName(),
): Promise<string> {
  const id = await newWorker(t.app, org.owner.cookie, departmentId, { name });
  const steps: Array<[string, string, Record<string, unknown>?]> = [];
  if (status !== 'draft' && status !== 'offboarded') steps.push(['startProbation', 'draft']);
  if (status === 'active' || status === 'suspended') steps.push(['activate', 'probation']);
  if (status === 'suspended') steps.push(['suspend', 'active']);
  if (status === 'offboarded')
    steps.push(['offboard', 'draft', { reason: 'Tạo nhầm', confirmName: name }]);
  for (const [event, from, extra] of steps) {
    const res = await transition(t.app, org.owner.cookie, id, event, from, extra);
    if (res.statusCode !== 200) throw new Error(`${event}: ${res.statusCode} ${res.body}`);
  }
  return id;
}

/** The worker row as dw_app sees it inside its company. */
export async function workerRow(harness: Harness, companyId: string, id: string) {
  const [row] = await sqlIn(
    harness,
    companyId,
    `select status, monthly_budget_vnd, manager_member_id, department_id, job_description,
            probation_started_on::text, probation_ends_on::text, revision
       from workers where id = $1`,
    [id],
  );
  return row as
    | {
        status: string;
        monthly_budget_vnd: string;
        manager_member_id: string | null;
        department_id: string;
        job_description: string;
        probation_started_on: string | null;
        probation_ends_on: string | null;
        revision: number;
      }
    | undefined;
}

export async function historyRows(harness: Harness, companyId: string, id: string) {
  return sqlIn(
    harness,
    companyId,
    'select kind, from_status, to_status, actor_member_id, reason, request_id, days from worker_status_events where worker_id = $1 order by created_at',
    [id],
  );
}
