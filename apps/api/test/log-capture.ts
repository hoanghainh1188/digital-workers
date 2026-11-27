import { Writable } from 'node:stream';
import { createLogger } from '@dw/core';

/** A real pino logger writing into memory, for asserting on log output. */
export function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...String(chunk).split('\n').filter(Boolean));
      done();
    },
  });
  const logger = createLogger('debug', stream);
  return { logger, text: () => lines.join('\n') };
}
