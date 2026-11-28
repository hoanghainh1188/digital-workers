import type { FastifyInstance } from 'fastify';
import { zipSync } from 'fflate';
import { WEB_ORIGIN } from './harness.ts';
import { call } from './org.ts';

/** Helpers for the skill library tests (change add-skill-library). */

let counter = 0;
export function skillName(label = 'lap-bao-gia'): string {
  counter += 1;
  return `${label}-${counter}`;
}

export const skillMd = (
  name: string,
  body = '# Lập báo giá\n\nSoạn văn bản báo giá theo mẫu.\n',
  description = 'Soạn báo giá theo mẫu.',
) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

const enc = (text: string) => new TextEncoder().encode(text);

export function zipOf(files: Record<string, string | Uint8Array>): Buffer {
  const input: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    input[path] = typeof content === 'string' ? enc(content) : content;
  }
  return Buffer.from(zipSync(input));
}

type RawMethod = 'POST' | 'PUT' | 'DELETE' | 'GET';

/** Request with a raw body (zip / file upload) or no body (DELETE). */
export function raw(
  app: FastifyInstance,
  method: RawMethod,
  url: string,
  cookie: string,
  body?: Buffer,
  contentType = 'application/zip',
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB_ORIGIN,
      cookie,
      ...(body ? { 'content-type': contentType } : {}),
    },
    ...(body ? { payload: body } : {}),
  });
}

export async function createSkill(
  app: FastifyInstance,
  cookie: string,
  md: string,
): Promise<string> {
  const res = await call(app, 'POST', '/api/skills', cookie, { skillMd: md });
  if (res.statusCode !== 201) throw new Error(`skill: ${res.statusCode} ${res.body}`);
  return res.json().id as string;
}

export async function detailOf(app: FastifyInstance, cookie: string, id: string) {
  const res = await call(app, 'GET', `/api/skills/${id}`, cookie);
  if (res.statusCode !== 200) throw new Error(`detail: ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function submit(
  app: FastifyInstance,
  cookie: string,
  id: string,
  risk: 'low' | 'medium' | 'high' = 'low',
  changeNote: string | null = null,
) {
  const { draftRevision } = await detailOf(app, cookie, id);
  return call(app, 'POST', `/api/skills/${id}/draft/submit`, cookie, {
    revision: draftRevision,
    proposedRisk: risk,
    changeNote,
  });
}

export function approve(
  app: FastifyInstance,
  cookie: string,
  id: string,
  n: number,
  risk: 'low' | 'medium' | 'high' = 'low',
) {
  return call(app, 'POST', `/api/skills/${id}/versions/${n}/approve`, cookie, { risk });
}

/** Saves a new SKILL.md into the draft (opening one when there is none). */
export async function edit(app: FastifyInstance, cookie: string, id: string, md: string) {
  const { draftRevision } = await detailOf(app, cookie, id);
  return call(app, 'PUT', `/api/skills/${id}/draft`, cookie, {
    skillMd: md,
    revision: draftRevision,
  });
}

/** A skill with v1 approved (owner / admin cookie); optionally with scripts/. */
export async function approvedSkill(
  app: FastifyInstance,
  approver: string,
  options: { name?: string; scripts?: boolean } = {},
): Promise<{ id: string; name: string }> {
  const name = options.name ?? skillName('ky-nang');
  const id = await createSkill(app, approver, skillMd(name));
  if (options.scripts) {
    const res = await raw(
      app,
      'PUT',
      `/api/skills/${id}/draft/files/scripts/doi_chieu.py?revision=0`,
      approver,
      Buffer.from('print("x")'),
      'application/octet-stream',
    );
    if (res.statusCode !== 200) throw new Error(`script: ${res.statusCode} ${res.body}`);
  }
  const risk = options.scripts ? 'high' : 'low';
  const sent = await submit(app, approver, id, risk);
  if (sent.statusCode !== 200) throw new Error(`submit: ${sent.statusCode} ${sent.body}`);
  const ok = await approve(app, approver, id, 1, risk);
  if (ok.statusCode !== 200) throw new Error(`approve: ${ok.statusCode} ${ok.body}`);
  return { id, name };
}

export function assign(app: FastifyInstance, cookie: string, workerId: string, skillId: string) {
  return call(app, 'POST', `/api/workers/${workerId}/skills`, cookie, { skillId });
}
