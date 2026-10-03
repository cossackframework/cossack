// @vitest-environment node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';
it('infers declared native API contracts through published package exports', async () => {
    const require = createRequire(import.meta.url);
    const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const project = fileURLToPath(new URL('./fixtures/api-types/tsconfig.json', import.meta.url));
    try { await promisify(execFile)(process.execPath, [compiler, '-p', project], { timeout: 30000 }); }
    catch (error: any) { throw new Error(`Published API types failed:\n${error.stdout}\n${error.stderr}`); }
}, 35000);
