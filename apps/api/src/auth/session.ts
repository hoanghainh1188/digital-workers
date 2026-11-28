import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth.ts';

export type SessionUser = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** TOTP turned on (twoFactor plugin). */
  readonly twoFactorEnabled: boolean;
  /** When this session was created, i.e. the sign-in time (platform admin 12 h rule). */
  readonly sessionCreatedAt: Date;
};

/** The signed-in user for these request headers, or null. */
export async function readSessionUser(
  auth: Auth,
  headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!session) return null;
  const { user } = session;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled === true,
    sessionCreatedAt: new Date(session.session.createdAt),
  };
}
