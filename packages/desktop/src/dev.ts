#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentGraphicsArgs, developmentSandboxArgs, type SandboxHelperMetadata } from './dev-signals.js';

const cwd = process.cwd();
const requireFromProject = createRequire(path.join(cwd, 'package.json'));
const executable = requireFromProject('electron') as string;
let helper: SandboxHelperMetadata | undefined;
try {
  const stats = statSync(path.join(path.dirname(executable), 'chrome-sandbox'));
  helper = { uid: stats.uid, mode: stats.mode };
} catch {}
const flags = [
  ...developmentSandboxArgs(process.platform, helper),
  ...developmentGraphicsArgs(process.platform, process.env),
];
if (flags.includes('--no-sandbox'))
  process.stderr.write(
    '[desktop] Using the development-only Linux --no-sandbox fallback for an unconfigured SUID helper.\n',
  );
let child: ChildProcess | undefined;
let stopping = false,
  restarting = false;
let deadline: NodeJS.Timeout | undefined;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  child?.kill('SIGTERM');
  if (child) deadline = setTimeout(() => child?.kill('SIGKILL'), 6000);
}
const forwarded = process.argv.slice(2);
if (forwarded[0] === '--') forwarded.shift();
function launch() {
  child = spawn(
    executable,
    [...flags, ...forwarded, path.join(path.dirname(fileURLToPath(import.meta.url)), 'development-runtime.js')],
    {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '' },
    },
  );
  child.once('error', (error) => {
    console.error('[desktop]', error);
    stop(1);
  });
  child.on('message', (message) => {
    if (!stopping && (message as { type?: string })?.type === 'cossack:desktop-restart') {
      restarting = true;
      child?.kill('SIGTERM');
      deadline ??= setTimeout(() => child?.kill('SIGKILL'), 6000);
    }
  });
  child.once('exit', (code, signal) => {
    clearTimeout(deadline);
    deadline = undefined;
    child = undefined;
    if (stopping) return;
    if (restarting) {
      restarting = false;
      launch();
    } else stop(code ?? (signal ? 1 : 0));
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
process.once('exit', () => child?.kill('SIGTERM'));
launch();
