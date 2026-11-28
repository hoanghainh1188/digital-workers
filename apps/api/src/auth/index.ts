export {
  type Auth,
  type AuthDeps,
  createAuth,
  markEmailVerified,
  revokeUserSessions,
  userIdByEmail,
} from './auth.ts';
export {
  createFailedLoginLimiter,
  type FailedLoginLimiter,
  normalizeEmail,
} from './failed-login-limiter.ts';
export { registerAuthRoutes } from './routes.ts';
export { readSessionUser, type SessionUser } from './session.ts';
export { type SignUpResult, signUpInvited, signUpWithEmail } from './sign-up.ts';
