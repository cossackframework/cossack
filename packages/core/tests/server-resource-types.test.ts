// @vitest-environment node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';

it('checks declared resource names and inferred status values through published exports', async () => {
    const require = createRequire(import.meta.url);
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const project = fileURLToPath(new URL('./fixtures/server-resource-types/tsconfig.json', import.meta.url));
    try { await promisify(execFile)(process.execPath, [tsc, '-p', project], { timeout: 30000 }); }
    catch (error: any) { throw new Error(`Resource types failed:\n${error.stdout}\n${error.stderr}`); }
}, 35000);
