import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth.ts';

export type SessionUser = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
};

/** The signed-in user for these request headers, or null. */
export async function readSessionUser(
  auth: Auth,
  headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!session) return null;
  const { user } = session;
  return { userId: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified };
}
