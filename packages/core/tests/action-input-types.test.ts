// @vitest-environment node
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'vitest';

it('infers schema/raw types and checks native method signatures through published declarations', async () => {
    const require=createRequire(import.meta.url);
    const tsc=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
    const project=fileURLToPath(new URL('./fixtures/action-input-types/tsconfig.json',import.meta.url));
    try {await promisify(execFile)(process.execPath,[tsc,'-p',project],{timeout:30000});}
    catch(error:any){throw new Error(`Input types failed:\n${error.stdout}\n${error.stderr}`);}
},35000);
