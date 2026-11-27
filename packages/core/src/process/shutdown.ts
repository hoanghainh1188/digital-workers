type ShutdownLogger = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

/**
 * Runs `close` once on SIGTERM/SIGINT, then exits 0. If closing hangs past
 * `timeoutMs` or throws, exits 1 so the orchestrator can restart cleanly.
 */
export function onShutdown(
  close: () => Promise<void>,
  logger: ShutdownLogger,
  timeoutMs = 10_000,
): void {
  let closing = false;
  const handle = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'shutdown timed out');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    close().then(
      () => {
        logger.info({}, 'stopped');
        process.exit(0);
      },
      (error: unknown) => {
        logger.error({ error: describeError(error) }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', handle);
  process.once('SIGINT', handle);
}

/**
 * Reduces an error to fields that are safe to log: message and code only.
 * Never logs the error object itself (it may carry config or request data).
 */
export function describeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? { message: error.message, code } : { message: error.message };
  }
  return { message: 'non-error thrown' };
}
