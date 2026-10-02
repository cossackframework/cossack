#!/usr/bin/env node
/**
 * `cossack` CLI — entrypoint.
 *
 * Most commands (generate, delete, routes, add, create, dev, build, ...)
 * are plain filesystem/string work and run directly under node.
 *
 * Database commands load TypeScript through the application's ORM tooling.
 * Studio re-spawns under tsx to import its application/server modules.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dispatch } from '../src/dispatch.js';

const RESPAWN_FLAG = '__COSSACK_STUDIO_RESPAWNED';

const argv = process.argv.slice(2);

const [command] = argv;
const needsTsx = command === 'studio';

if (needsTsx && !process.env[RESPAWN_FLAG]) {
  // Resolve tsx from this package's own deps so it is found regardless of cwd.
  const requireFromHere = createRequire(import.meta.url);
  let tsxImportUrl;
  try {
    tsxImportUrl = pathToFileURL(requireFromHere.resolve('tsx')).href;
  } catch {
    console.error(
      '[cossack] Could not resolve "tsx". Ensure the "cossack" package is installed.',
    );
    process.exit(1);
  }
  const binPath = fileURLToPath(import.meta.url);
  const child = spawn(
    process.execPath,
    ['--import', tsxImportUrl, binPath, ...argv],
    {
      stdio: 'inherit',
      env: { ...process.env, [RESPAWN_FLAG]: '1' },
    },
  );
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  // Plain path, or Studio after activating its loader.
  dispatch(argv).then(
    (code) => process.exit(code ?? 0),
    (err) => {
      console.error(err?.stack || err?.message || String(err));
      process.exit(1);
    },
  );
}
