// Emits dist/esm into a private staging directory and moves it into place, so
// concurrent consumers (integration tests, linked generated apps, dev servers)
// never observe a missing or half-written dist/esm while the framework rebuilds.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const target = path.join(dist, 'esm');
const id = `${process.pid}-${Date.now()}`;
const staging = path.join(dist, `.esm-next-${id}`);

fs.mkdirSync(dist, { recursive: true });
// typescript's exports map hides bin/, so resolve it beside the main entry (lib/typescript.js).
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), '..', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.declarations.json', '--outDir', staging], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  fs.rmSync(staging, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

// Move each emitted file over its predecessor (rename replaces a file in one
// step), then drop files the new build no longer emits. dist/esm and every
// file in it stay readable throughout.
const emitted = new Set();
for (const entry of fs.readdirSync(staging, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const relative = path.relative(staging, path.join(entry.parentPath, entry.name));
  emitted.add(relative);
  fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
  fs.renameSync(path.join(staging, relative), path.join(target, relative));
}
for (const entry of fs.readdirSync(target, { recursive: true, withFileTypes: true })) {
  const file = path.join(entry.parentPath, entry.name);
  if (entry.isFile() && !emitted.has(path.relative(target, file))) fs.rmSync(file, { force: true });
}
fs.rmSync(staging, { recursive: true, force: true });
