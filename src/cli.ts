#!/usr/bin/env node
import { main } from './cli/main.js';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;

const controller = new AbortController();
for (const name of SIGNALS) {
  process.on(name, () => {
    if (!controller.signal.aborted) controller.abort(name);
  });
}

process.exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
  signal: controller.signal,
});
