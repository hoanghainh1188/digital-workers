/**
 * Per-email sign-in limit (0.2 #044, design D6): 10 failed attempts within 15
 * minutes block that email until the window ends. Only failures count; a success
 * clears the counter. In memory: there is a single api process (NFR-10).
 */
export type FailedLoginLimiter = {
  readonly isBlocked: (email: string) => boolean;
  readonly recordFailure: (email: string) => void;
  readonly reset: (email: string) => void;
};

export function createFailedLoginLimiter(
  options: { maxFailures?: number; windowMs?: number; now?: () => number } = {},
): FailedLoginLimiter {
  const maxFailures = options.maxFailures ?? 10;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { failures: number; windowEndsAt: number }>();

  const current = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.windowEndsAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return Object.freeze({
    isBlocked: (email: string) => (current(normalizeEmail(email))?.failures ?? 0) >= maxFailures,
    recordFailure: (email: string) => {
      const key = normalizeEmail(email);
      const entry = current(key);
      entries.set(key, {
        failures: (entry?.failures ?? 0) + 1,
        windowEndsAt: entry?.windowEndsAt ?? now() + windowMs,
      });
    },
    reset: (email: string) => {
      entries.delete(normalizeEmail(email));
    },
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
