import { isMessageKey, t } from '../i18n/t.ts';
import { ApiError } from './api.ts';

export type FieldIssue = { readonly path: string; readonly message: string };
export type FieldErrors = Readonly<Record<string, string>>;

/** Vietnamese text for one error code from the shared Zod schemas (FIELD_ERRORS). */
export function fieldErrorMessage(field: string, code: string): string {
  const specific = `form.${code}.${field}`;
  if (isMessageKey(specific)) return t(specific);
  const general = `form.${code}`;
  return isMessageKey(general) ? t(general) : t('form.invalid');
}

/** First message per field, from Zod issues (client) or API error details (server). */
export function toFieldErrors(issues: readonly FieldIssue[]): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.split('.')[0] ?? '';
    if (field && !(field in errors)) errors[field] = fieldErrorMessage(field, issue.message);
  }
  return errors;
}

/** Adapts a Zod error's issues to FieldIssue (path joined with dots). */
export function fromZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): FieldIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** One Vietnamese sentence for a failed API call (code-specific when we have one). */
export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('app.error.network');
  const key = `error.${error.code}`;
  return isMessageKey(key) ? t(key) : t('app.error.generic');
}
