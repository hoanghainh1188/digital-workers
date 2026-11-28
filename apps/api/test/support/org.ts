import { members, withCompany } from '@dw/db';
import type { SentEmail } from '@dw/mail';
import type { FastifyInstance } from 'fastify';
import {
  cookieHeader,
  type Harness,
  STRONG_PASSWORD,
  signIn,
  signUp,
  type TestApp,
  uniqueEmail,
  WEB_ORIGIN,
} from './harness.ts';

export type Person = {
  readonly memberId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  cookie: string;
};

export type OrgTenant = {
  readonly companyId: string;
  readonly departmentId: string;
  readonly owner: Person;
  readonly admin: Person;
  readonly manager: Person;
  readonly member: Person;
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

/** JSON request with the trusted Origin (and a session cookie when given). */
export function call(
  app: FastifyInstance,
  method: Method,
  url: string,
  cookie?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

export async function verifyEmail(harness: Harness, email: string): Promise<void> {
  await harness.database.pool.query(
    'update auth.users set email_verified = true where email = $1',
    [email],
  );
}

/** Creates an account and attaches it to the company with `role` (direct insert). */
export async function addPerson(
  t: TestApp,
  harness: Harness,
  companyId: string,
  role: 'owner' | 'admin' | 'manager' | 'member',
  departmentId: string | null,
  name = `Người ${role}`,
): Promise<Person> {
  const email = uniqueEmail(role);
  const account = await t.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: WEB_ORIGIN },
    payload: { name, email, password: STRONG_PASSWORD },
  });
  const userId = account.json().user.id as string;
  const memberId = await withCompany(harness.database, companyId, async (tx) => {
    const [row] = await tx
      .insert(members)
      .values({ companyId, userId, role, departmentId })
      .returning({ id: members.id });
    return row?.id ?? '';
  });
  const cookie = cookieHeader(await signIn(t.app, email));
  return { memberId, userId, email, name, cookie };
}

/**
 * A company with a verified Owner, an Admin, and a Manager + Member in department
 * "Kinh doanh"; everyone signed in.
 */
export async function seedOrg(
  t: TestApp,
  harness: Harness,
  companyName: string,
): Promise<OrgTenant> {
  const signedUp = await signUp(t.app, { companyName, name: 'Trần Minh Đức' });
  const companyId = signedUp.companyId ?? '';
  await verifyEmail(harness, signedUp.email);
  const me = (await call(t.app, 'GET', '/api/me', signedUp.cookie)).json();
  const owner: Person = {
    memberId: me.member.id,
    userId: me.user.id,
    email: signedUp.email,
    name: 'Trần Minh Đức',
    cookie: signedUp.cookie,
  };
  const dept = await call(t.app, 'POST', '/api/departments', owner.cookie, { name: 'Kinh doanh' });
  if (dept.statusCode !== 201) throw new Error(`department: ${dept.statusCode} ${dept.body}`);
  const departmentId = dept.json().id as string;
  const admin = await addPerson(t, harness, companyId, 'admin', null, 'Lê Quốc Anh');
  const manager = await addPerson(t, harness, companyId, 'manager', departmentId, 'Nguyễn Thị Lan');
  const member = await addPerson(t, harness, companyId, 'member', departmentId, 'Hoàng Văn Việt');
  await verifyEmail(harness, admin.email);
  return { companyId, departmentId, owner, admin, manager, member };
}

export async function createDepartment(
  app: FastifyInstance,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await call(app, 'POST', '/api/departments', cookie, { name });
  if (res.statusCode !== 201) throw new Error(`department: ${res.statusCode} ${res.body}`);
  return res.json().id as string;
}

/** The token from the newest invitation email to `to` (link `/invite#token=…`). */
export function invitationToken(sent: readonly SentEmail[], to: string): string {
  const email = [...sent].reverse().find((item) => item.to === to);
  const match = email?.text.match(/\/invite#token=([\w%-]+)/);
  if (!match?.[1]) throw new Error(`no invitation email for ${to}`);
  return decodeURIComponent(match[1]);
}

/** Reads one member row as dw_app inside its company. */
export async function memberRow(harness: Harness, companyId: string, memberId: string) {
  const client = await harness.database.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    const { rows } = await client.query(
      'select role, status, department_id, locked_at from members where id = $1',
      [memberId],
    );
    await client.query('commit');
    return rows[0] as
      | { role: string; status: string; department_id: string | null; locked_at: Date | null }
      | undefined;
  } finally {
    client.release();
  }
}

/** Runs one SQL statement as dw_app inside `companyId` (test fixtures only). */
export async function sqlIn(
  harness: Harness,
  companyId: string,
  statement: string,
  params: unknown[] = [],
) {
  const client = await harness.database.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.company_id', $1, true)", [companyId]);
    const result = await client.query(statement, params);
    await client.query('commit');
    return result.rows;
  } finally {
    client.release();
  }
}
