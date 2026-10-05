// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('registered catalogs reject unknown keys and missing/wrong parameters while unregistered apps retain string keys', async () => {
    const require = createRequire(import.meta.url);
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-i18n-types-'));
    const source = path.resolve(import.meta.dirname, '../src/shared/i18n.ts');
    try {
        const options = { compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ESNext', 'DOM'], strict: true, skipLibCheck: true, noEmit: true, types: [], paths: { '@cossackframework/core': [source] } }, files: ['index.ts'] };
        await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(options));
        await fs.writeFile(path.join(root, 'index.ts'), `import { __ } from '@cossackframework/core';\n__('Intentional string as key'); __('dynamic', { name: 'Sam' });\n`);
        await promisify(execFile)(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')], { timeout: 30000 });
        await fs.writeFile(path.join(root, 'index.ts'), `import { __ } from '@cossackframework/core';
        declare module '@cossackframework/core' { interface CossackTranslationRegistry { hello: {}; welcome: { name: string | number }; apples: { count: number } } }
        __('hello'); __('welcome', { name: 'Sam' }); __('apples', { count: 2 });
        // @ts-expect-error Unknown keys are rejected after registration.
        __('unknown');
        // @ts-expect-error Required params cannot be omitted.
        __('welcome');
        // @ts-expect-error Required placeholders cannot be renamed.
        __('welcome', { person: 'Sam' });
        // @ts-expect-error Plural count must be numeric.
        __('apples', { count: '2' });
        // @ts-expect-error An arbitrary dynamic string is not a registered key.
        __('hello' as string);
        `);
        await promisify(execFile)(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')], { timeout: 30000 });
        expect(true).toBe(true);
    } catch (error: any) { throw new Error(`Localization types failed:\n${error.stdout ?? error.message}\n${error.stderr ?? ''}`); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
}, 65000);
