import type pg from 'pg';

/**
 * Resolves true when `SELECT 1` succeeds within `timeoutMs`, false otherwise.
 * Never throws; the caught error is handed to `onError` for server-side logging.
 */
export async function ping(
  pool: pg.Pool,
  timeoutMs: number,
  onError: (error: unknown) => void = () => {},
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database ping timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return true;
  } catch (error) {
    onError(error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
