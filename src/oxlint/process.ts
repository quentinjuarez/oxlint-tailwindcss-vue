import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export function runNode(
  script: string,
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal },
): Promise<ProcessResult> {
  const { TERMINAL_EMULATOR: _removed, ...env } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const kill = (): void => {
      child.kill();
    };
    const { signal } = options;
    if (signal?.aborted) kill();
    signal?.addEventListener('abort', kill, { once: true });

    child.on('error', (error) => {
      signal?.removeEventListener('abort', kill);
      reject(error);
    });
    child.on('close', (code, closeSignal) => {
      signal?.removeEventListener('abort', kill);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        signal: closeSignal,
      });
    });
  });
}
