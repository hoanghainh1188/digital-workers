import type {
  RiskLevel,
  SkillStatus,
  SkillVersionStatus,
  WorkerSkillStatus,
} from '@dw/core/skills';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { isMessageKey, t, tf } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/vi.ts';
import { ApiError, api } from './api.ts';
import type { Person } from './org.ts';

/** Shapes returned by /api/skills* (apps/api/src/skills/views.ts, assignments.ts, packages.ts). */

export type CheckLevel = 'ok' | 'warn' | 'error';
export type Check = {
  check: string;
  level: CheckLevel;
  path?: string;
  params?: Record<string, string | number>;
};

export type SkillCard = {
  id: string;
  name: string;
  title: string;
  description: string;
  status: SkillStatus;
  currentNumber: number | null;
  pendingNumber: number | null;
  draftNumber: number | null;
  risk: RiskLevel;
  hasScripts: boolean;
  workerCount: number;
  updatedAt: string;
};

export type VersionEntry = {
  number: number;
  status: SkillVersionStatus;
  changeNote: string | null;
  risk: RiskLevel | null;
  proposedRisk: RiskLevel | null;
  suggestedRisk: RiskLevel;
  hasScripts: boolean;
  everApproved: boolean;
  createdBy: Person | null;
  createdAt: string;
  submittedBy: Person | null;
  submittedAt: string | null;
  decidedBy: Person | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

export type SkillHolder = {
  workerId: string;
  workerName: string;
  workerStatus: string;
  departmentId: string;
  status: WorkerSkillStatus;
  assignedBy: Person | null;
  requestedAt: string;
};

export type SkillDetail = SkillCard & {
  archived: boolean;
  draftRevision: number | null;
  focusNumber: number;
  versions: VersionEntry[];
  holders: SkillHolder[];
  holderCount: number;
};

export type VersionView = {
  number: number;
  status: SkillVersionStatus;
  title: string;
  description: string;
  hasScripts: boolean;
  suggestedRisk: RiskLevel;
  proposedRisk: RiskLevel | null;
  risk: RiskLevel | null;
  changeNote: string | null;
  revision: number;
  isCurrent: boolean;
  comparedTo: number | null;
  skillMd: string;
  files: { path: string; size: number; mediaType: string }[];
};

export type TemplateCard = {
  name: string;
  title: string;
  description: string;
  suggestedRisk: RiskLevel;
  files: string[];
};

export type DraftSaved = {
  number: number;
  revision: number;
  hasScripts: boolean;
  suggestedRisk: RiskLevel;
  checks: Check[];
};

export type ImportPreview = {
  ok: boolean;
  checks: Check[];
  summary: {
    name: string | null;
    title: string | null;
    description: string | null;
    fileCount: number;
    unpackedBytes: number;
    hasScripts: boolean;
    suggestedRisk: RiskLevel;
  };
};

export type WorkerSkill = {
  skillId: string;
  name: string;
  title: string;
  status: WorkerSkillStatus;
  currentNumber: number | null;
  pendingNumber: number | null;
  risk: RiskLevel | null;
  hasScripts: boolean;
  assignedBy: Person | null;
  decidedBy: Person | null;
  requestedAt: string;
};

export type SkillSearch = {
  q?: string;
  status?: SkillStatus;
  risk?: RiskLevel;
  archived?: boolean;
};

export const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export const skillsQuery = (search: SkillSearch = {}) =>
  queryOptions({
    queryKey: ['skills', 'list', search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.q) params.set('q', search.q);
      if (search.status && search.status !== 'archived') params.set('status', search.status);
      if (search.risk) params.set('risk', search.risk);
      if (search.archived || search.status === 'archived') params.set('archived', 'true');
      const query = params.toString();
      return api<{ skills: SkillCard[] }>(`/api/skills${query ? `?${query}` : ''}`);
    },
  });

export const skillQuery = (id: string) =>
  queryOptions({
    queryKey: ['skills', 'detail', id],
    queryFn: () => api<SkillDetail>(`/api/skills/${id}`),
  });

export const versionQuery = (id: string, n: number) =>
  queryOptions({
    queryKey: ['skills', 'version', id, n],
    queryFn: () => api<VersionView>(`/api/skills/${id}/versions/${n}`),
  });

export const templatesQuery = queryOptions({
  queryKey: ['skill-templates'],
  queryFn: () => api<{ templates: TemplateCard[] }>('/api/skill-templates'),
  staleTime: Number.POSITIVE_INFINITY,
});

export const workerSkillsQuery = (workerId: string) =>
  queryOptions({
    queryKey: ['skills', 'worker', workerId],
    queryFn: () =>
      api<{ skills: WorkerSkill[]; canAssign: boolean; canApprove: boolean }>(
        `/api/workers/${workerId}/skills`,
      ),
  });

/** Every skill change refreshes skill lists, details and worker tabs (they are small). */
export function useRefreshSkills() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['skills'] });
}

export function useSkillMutation<Body, Result = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
) {
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: (body: Body) => api<Result>(path, { method, body }),
    onSuccess: refresh,
  });
}

/** Raw body (zip, attached file) or no body; JSON reply; ApiError on failure. */
export async function sendRaw<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: Blob,
  contentType = 'application/octet-stream',
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': contentType } : {},
    body: body ?? undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(response.status, String(error.code ?? 'UNKNOWN'), error.details ?? []);
  }
  return payload as T;
}

/** Checks attached to a 422 PACKAGE_INVALID error, if any. */
export function checksOf(error: unknown): Check[] | null {
  if (!(error instanceof ApiError)) return null;
  const info = error.info as { checks?: Check[] } | null;
  return Array.isArray(info?.checks) ? info.checks : null;
}

/** "a/b c.md" → "a/b%20c.md": every segment encoded, slashes kept. */
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

const BYTE_CHECKS = new Set(['TOO_LARGE_UNPACKED', 'SKILL_MD_TOO_LARGE', 'TOO_LARGE']);

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function params(item: Check): Record<string, string | number> {
  const values: Record<string, string | number> = { path: item.path ?? '', ...item.params };
  if (BYTE_CHECKS.has(item.check) && typeof values.max === 'number') {
    values.max = formatBytes(values.max);
  }
  if (typeof values.description === 'string' && values.description.length > 80) {
    values.description = `${values.description.slice(0, 80)}…`;
  }
  return values;
}

/** Title and how-to-fix text of one check line, in Vietnamese. */
export function checkText(item: Check): { title: string; fix: string | null } {
  const errorKey = `check.${item.check}.error`;
  const key = item.level === 'error' && isMessageKey(errorKey) ? errorKey : `check.${item.check}`;
  const values = params(item);
  if (!isMessageKey(key)) return { title: tf('check.unknown', { code: item.check }), fix: null };
  const fixKey = `check.${item.check}.fix`;
  return {
    title: tf(key, values),
    fix: isMessageKey(fixKey) ? tf(fixKey as MessageKey, values) : null,
  };
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Light check while typing (design D4 runs the full check on the server: @dw/skills uses
 * gray-matter, which needs Node's Buffer). Reads only `name:` and `description:` lines.
 */
export function quickCheck(text: string, expectedName: string | null): string[] {
  const source = text.replace(/^﻿/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return [t('editor.check.frontmatter')];
  const end = lines.indexOf('---', 1);
  if (end < 0) return [t('editor.check.frontmatter')];
  const front = lines.slice(1, end);
  const value = (field: string) => {
    const line = front.find((entry) => entry.startsWith(`${field}:`));
    return line
      ?.slice(field.length + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  };
  const problems: string[] = [];
  const name = value('name') ?? '';
  if (!NAME.test(name) || name.length > 64) problems.push(t('editor.check.name'));
  else if (expectedName && name !== expectedName) {
    problems.push(tf('editor.check.nameChanged', { name: expectedName }));
  }
  if (!value('description')) problems.push(t('editor.check.description'));
  return problems;
}

/** Starter SKILL.md for "Viết kỹ năng" (a unique name the author renames once). */
export function starterSkillMd(): string {
  return tf('skills.starterBody', { suffix: Math.random().toString(36).slice(2, 7) });
}
