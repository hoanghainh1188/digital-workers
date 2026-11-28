import type { IncomingHttpHeaders } from 'node:http';
import type { Database } from '@dw/db';
import { fromNodeHeaders } from 'better-auth/node';
import { type Auth, markEmailVerified, withoutVerificationEmail } from './auth.ts';

export type SignUpResult =
  | { readonly ok: true; readonly userId: string; readonly setCookies: readonly string[] }
  | { readonly ok: false; readonly status: number; readonly code: string };

/** Creates the account through Better Auth and returns its session cookies (design D4). */
export async function signUpWithEmail(
  auth: Auth,
  input: { name: string; email: string; password: string },
  headers: IncomingHttpHeaders,
): Promise<SignUpResult> {
  const response = await auth.api.signUpEmail({
    body: input,
    headers: fromNodeHeaders(headers),
    asResponse: true,
  });
  const body = (await response.json().catch(() => null)) as {
    user?: { id?: string };
    code?: string;
  } | null;
  if (!response.ok || !body?.user?.id) {
    return { ok: false, status: response.status, code: body?.code ?? 'SIGN_UP_FAILED' };
  }
  return { ok: true, userId: body.user.id, setCookies: response.headers.getSetCookie() };
}

/**
 * Account for someone accepting an invitation (design D4): no verification email,
 * and the email is marked verified right away (0.2 #033).
 */
export async function signUpInvited(
  auth: Auth,
  database: Database,
  input: { name: string; email: string; password: string },
  headers: IncomingHttpHeaders,
): Promise<SignUpResult> {
  const result = await withoutVerificationEmail(input.email, () =>
    signUpWithEmail(auth, input, headers),
  );
  if (result.ok) await markEmailVerified(database, result.userId);
  return result;
}
