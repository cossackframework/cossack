// @vitest-environment node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';
it('checks URL state through published core and portable exports', async () => {
    const require = createRequire(import.meta.url);
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const project = fileURLToPath(new URL('./fixtures/url-state-types/tsconfig.json', import.meta.url));
    try { await promisify(execFile)(process.execPath, [tsc, '-p', project], { timeout: 30000 }); }
    catch (error: any) { throw new Error(`URL state types failed:\n${error.stdout}\n${error.stderr}`); }
}, 35000);
