import { it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
it('checks authored rows and accessors through the published declarations', async () => {
    const require=createRequire(import.meta.url);
    const tsc=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
    const config=fileURLToPath(new URL('./fixtures/data-table-types/tsconfig.json',import.meta.url));
    try { await promisify(execFile)(process.execPath,[tsc,'-p',config],{timeout:30000}); }
    catch(error:any) { throw new Error(error.stdout+'\n'+error.stderr); }
},35000);
