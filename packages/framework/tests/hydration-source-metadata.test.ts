import { expect, it } from 'vitest';
import path from 'node:path';
import { parseSync } from 'vite';
import { cossackPages } from '../src/vite-plugin';
it('injects relative component source positions only for development transforms', async () => {
    const plugin = cossackPages();
    const transform = plugin.transform as Function;
    const file = path.join(process.cwd(), 'src/pages/diagnostic.ts');
    const code = "import { Cossack } from '@cossackframework/core';\nexport default class Diagnostic extends Cossack { render(){return null;} }";
    const dev = await transform.call({ environment: { mode: 'dev' } }, code, file);
    expect(dev.code).toContain('static __source = {"file":"src/pages/diagnostic.ts","line":2,"column":16}');
    expect(dev.code).not.toContain(process.cwd());
    const prod = await transform.call({ environment: { mode: 'build' } }, code, file);
    expect(prod.code).toBe(code);
});

it('uses compiler offsets for Unicode and ignores class text in strings and comments', async () => {
    const plugin = cossackPages();
    const file = path.join(process.cwd(), 'src/pages/unicode.ts');
    const code = `const label = "é😀 class Fake extends Cossack {}";
// class Comment extends Cossack {}
export class Actual extends RenamedBase { render(){return label;} }`;
    const dev = await (plugin.transform as Function).call({ environment: { mode: 'dev' } }, code, file);
    expect(parseSync(file, dev.code).errors).toEqual([]);
    expect(dev.code.match(/static __source/g)).toHaveLength(1);
    expect(dev.code).toContain('"line":3,"column":8');
    expect(dev.code).toContain('"é😀 class Fake extends Cossack {}"');
});
