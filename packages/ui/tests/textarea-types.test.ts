import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Textarea } from '../src/components/Textarea';
import { renderToString } from '@cossackframework/renderer';

it('keeps textarea dimensions numeric and disabled props boolean under strict public component typing', async () => {
    const require = createRequire(import.meta.url);
    const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    const config = fileURLToPath(new URL('./fixtures/textarea-types/tsconfig.json', import.meta.url));
    try { await promisify(execFile)(process.execPath, [compiler, '-p', config], { timeout: 30000 }); }
    catch (error: any) { throw new Error(error.stdout + '\n' + error.stderr); }
}, 35000);

it('renders native textarea dimensions and boolean attributes without changing their contracts', () => {
    const textarea = new Textarea();
    textarea.props = { rows: 6, cols: 80, disabled: false, required: true };
    const html = renderToString(textarea.render());
    expect(html).toContain('rows="6"');
    expect(html).toContain('cols="80"');
    expect(html).not.toMatch(/<textarea[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain('required');
});
