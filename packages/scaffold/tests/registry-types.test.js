import { it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

it.each(['tsconfig.json', 'tsconfig.node.json'])('checks public scaffold declarations with %s', async configName => {
  const require = createRequire(import.meta.url);
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const config = fileURLToPath(new URL(`./fixtures/registry-types/${configName}`, import.meta.url));
  try { await promisify(execFile)(process.execPath, [tsc, '-p', config], { timeout: 30000 }); }
  catch (error) { throw new Error(`Registry declaration check failed:\n${error.stdout}\n${error.stderr}`); }
}, 35000);
