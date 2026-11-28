import type { FieldIssue } from './form-errors.ts';

/** An error response from our API (envelope `{ error: { code, message, details? } }`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly FieldIssue[];
  /** Non-field details, e.g. `{ members, invitations }` for DEPARTMENT_NOT_EMPTY. */
  readonly info: unknown;

  constructor(status: number, code: string, details: unknown = []) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.info = Array.isArray(details) ? null : details;
  }
}

/** JSON fetch to the same-origin API (cookies included). Throws ApiError on 4xx/5xx. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? payload ?? {};
    throw new ApiError(response.status, String(error.code ?? 'UNKNOWN'), error.details ?? []);
  }
  return payload as T;
}
