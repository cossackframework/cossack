// @vitest-environment node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('checks state mechanism documentation examples through published exports', async () => {
    const require = createRequire(import.meta.url);
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const project = fileURLToPath(new URL('./fixtures/state-docs/tsconfig.json', import.meta.url));
    try { await promisify(execFile)(process.execPath, [tsc, '-p', project], { timeout: 30000 }); }
    catch (error: any) { throw new Error(`State examples failed:\n${error.stdout}\n${error.stderr}`); }
}, 35000);

it('keeps published state diagnostics safe for a direct Node import without Vite', async () => {
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
        import { Cossack, State } from '@cossackframework/core';
        class Direct extends Cossack { data = { count: 1 }; }
        State()(Direct.prototype, 'data');
        const page = new Direct();
        page.connectedCallback();
        const raw = page.getPublicState().data;
        if (page.data !== raw) throw new Error('Diagnostic proxy enabled outside Vite');
        page.data.count++;
        if (page.getPublicState().data.count !== 2) throw new Error('State mutation failed');
        console.log('DIRECT_STATE_OK');
    `], { timeout: 10000 });
    expect(result.stdout).toContain('DIRECT_STATE_OK');
}, 15000);
