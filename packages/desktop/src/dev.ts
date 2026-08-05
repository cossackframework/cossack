#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  developmentGraphicsArgs,
  developmentSandboxArgs,
  isSuccessfulBuildOutput,
  type SandboxHelperMetadata,
} from './dev-signals.js';

const cwd = process.cwd();
const requireFromProject = createRequire(path.join(cwd, 'package.json'));
const viteBin = path.join(path.dirname(requireFromProject.resolve('vite/package.json')), 'bin', 'vite.js');
const electronBin = requireFromProject('electron') as string;
const mainEntry = path.resolve(cwd, 'dist/desktop/index.js');
let sandboxHelper: SandboxHelperMetadata | undefined;
try {
  const stats = statSync(path.join(path.dirname(electronBin), 'chrome-sandbox'));
  sandboxHelper = { uid: stats.uid, mode: stats.mode };
} catch {
  // A missing helper needs the same development-only fallback as a misconfigured helper.
}
const electronArgs = [
  ...developmentSandboxArgs(process.platform, sandboxHelper),
  ...developmentGraphicsArgs(process.platform, process.env),
];

if (electronArgs.includes('--no-sandbox')) {
  process.stderr.write(
    '[desktop] Linux SUID sandbox helper is not root-owned with mode 4755; ' +
    'using Electron --no-sandbox for desktop:dev only. Packaged installers remain sandboxed.\n',
  );
}

let electron: ChildProcess | undefined;
let rendererReady = false;
let mainReady = false;
let stopping = false;
let restartingElectron = false;

function pipe(child: ChildProcess, label: string, onBuild: () => void): void {
  const handle = (chunk: Buffer) => {
    const value = chunk.toString();
    process.stdout.write(`[${label}] ${value}`);
    if (isSuccessfulBuildOutput(value)) onBuild();
  };
  child.stdout?.on('data', handle);
  child.stderr?.on('data', (chunk: Buffer) => {
    const value = chunk.toString();
    process.stderr.write(`[${label}] ${value}`);
    if (isSuccessfulBuildOutput(value)) onBuild();
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0) shutdown(code ?? 1);
  });
}

function startElectron(): void {
  if (!rendererReady || !mainReady || stopping) return;
  electron = spawn(electronBin, [...electronArgs, mainEntry], {
    cwd,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  electron.on('exit', (code, signal) => {
    const wasRestarting = restartingElectron;
    restartingElectron = false;
    electron = undefined;
    if (stopping) return;
    if (wasRestarting) startElectron();
    else shutdown(code ?? (signal ? 1 : 0));
  });
}

function restartElectron(): void {
  if (!electron) return startElectron();
  restartingElectron = true;
  electron.kill();
}

function reloadRenderer(): void {
  if (electron?.connected) electron.send?.({ type: 'cossack:renderer-reload' });
  else startElectron();
}

function shutdown(code = 0): void {
  if (stopping) return;
  stopping = true;
  renderer.kill();
  main.kill();
  electron?.kill();
  process.exitCode = code;
}

const renderer = spawn(process.execPath, [viteBin, 'build', '--watch'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const main = spawn(process.execPath, [
  viteBin,
  'build',
  '--ssr',
  'src/desktop/index.ts',
  '--outDir',
  'dist/desktop',
  '--watch',
  '--minify',
  'false',
], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

pipe(renderer, 'renderer', () => {
  const initial = !rendererReady;
  rendererReady = true;
  if (initial) startElectron(); else reloadRenderer();
});
pipe(main, 'main', () => {
  const initial = !mainReady;
  mainReady = true;
  if (initial) startElectron(); else restartElectron();
});

process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));
process.once('exit', () => {
  stopping = true;
  renderer.kill();
  main.kill();
  electron?.kill();
});
