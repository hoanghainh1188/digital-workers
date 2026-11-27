import { createAuthClient } from 'better-auth/react';

/** Better Auth client for sign-in, Google, sign-out and resending the verification email. */
export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  basePath: '/api/auth',
});
