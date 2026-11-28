import { type DestinationStream, type Level, type Logger, pino } from 'pino';

/** Paths whose values must never reach the log (NFR-02, NFR-03). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  '*.DATABASE_URL',
  '*.connectionString',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
] as const;

export function createLogger(level: Level, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    serializers: { req: serializeRequest },
  };
  return destination ? pino(options, destination) : pino(options);
}

type LoggedRequest = { method?: string; url?: string; id?: unknown };

/** Path segments that are secrets themselves (password-reset link: /reset-password/<token>). */
const TOKEN_IN_PATH = /(\/reset-password\/)[^/?#]+/g;

/** Query strings can carry tokens (webhooks, OAuth callbacks): log the path only, no headers. */
export function serializeRequest(request: LoggedRequest) {
  const path = request.url?.split('?')[0]?.replace(TOKEN_IN_PATH, '$1[redacted]');
  return { method: request.method, url: path, reqId: request.id };
}
