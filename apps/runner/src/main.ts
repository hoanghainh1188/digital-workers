import { createLogger, loadConfigOrExit, onShutdown } from '@dw/core';
import { runnerConfigSchema } from './config.ts';

const config = loadConfigOrExit(runnerConfigSchema);
const logger = createLogger(config.LOG_LEVEL);

// Keeps the process alive until jobs arrive (pg-boss in add-worker-runtime-webchat).
const keepAlive = setInterval(() => {}, 60_000);

onShutdown(async () => {
  clearInterval(keepAlive);
}, logger);

logger.info({ env: config.NODE_ENV }, 'started');
