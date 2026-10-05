// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('bare framework translation calls enforce the actual public core registry', async () => {
    const require = createRequire(import.meta.url);
    const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const root = await mkdtemp(path.join(tmpdir(), 'cossack-global-localization-'));
    try {
        await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
            target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true,
            skipLibCheck: true, types: [], paths: { '@cossackframework/core': [path.resolve(import.meta.dirname, '../../core/dist/index.d.ts')] },
        }, files: ['index.ts', path.resolve(import.meta.dirname, '../src/vite-env.d.ts')] }));
        await writeFile(path.join(root, 'index.ts'), `import '@cossackframework/core';
declare module '@cossackframework/core' { interface CossackTranslationRegistry { hello: {}; welcome: { name: string | number }; items: { count: number } } }
__('hello'); __('welcome', { name: 'Sam' }); __('items', { count: 2 });
// @ts-expect-error A bare helper rejects an unknown registered key.
__('unknown');
// @ts-expect-error A bare helper requires the generated parameter.
__('welcome');
// @ts-expect-error Plural counts must be numbers.
__('items', { count: '2' });
`);
        const result = await promisify(execFile)(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.json')], { timeout: 30000 });
        expect(result.stdout).toBe('');
    } catch (error: any) { throw new Error(`Public localization types failed: ${error.stdout ?? error.message}`); }
    finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
