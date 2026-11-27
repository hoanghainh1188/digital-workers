import { type ChildProcess, spawn } from 'node:child_process';

export type ProcessResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type Running = {
  readonly child: ChildProcess;
  readonly output: () => { stdout: string; stderr: string };
  /** Resolves once stdout contains `text`; rejects after `timeoutMs`. */
  readonly waitFor: (text: string, timeoutMs?: number) => Promise<void>;
  readonly exited: Promise<ProcessResult>;
};

/** Starts `node <entry>` with exactly `env` (plus PATH) for black-box process tests. */
export function startNode(entry: string, env: Record<string, string>): Running {
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise<ProcessResult>((resolve) => {
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  const waitFor = (text: string, timeoutMs = 10_000) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`timed out waiting for "${text}". stdout: ${stdout} stderr: ${stderr}`));
      }, timeoutMs);
      const poll = setInterval(() => {
        if (stdout.includes(text)) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 20);
    });
  return { child, output: () => ({ stdout, stderr }), waitFor, exited };
}

export function runNode(entry: string, env: Record<string, string>): Promise<ProcessResult> {
  return startNode(entry, env).exited;
}

/** Asks the OS for a free TCP port (PORT=0 is rejected by config on purpose). */
export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
