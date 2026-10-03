import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cossackSecurityPlugin } from '../src/vite-security-plugin';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(source: string, route = true) {
    const root = mkdtempSync(join(tmpdir(), 'cossack-native-http-client-')); roots.push(root);
    const file = join(root, route ? 'src/pages/api' : 'src/helpers', 'count.ts');
    mkdirSync(join(root, route ? 'src/pages/api' : 'src/helpers'), { recursive: true }); writeFileSync(file, source);
    return file;
}
const load = async (file: string, environment = 'client') => {
    const plugin = cossackSecurityPlugin();
    return (plugin.load as Function).call({ environment: { name: environment } }, file + '?import#v');
};
it.each([
    `export const GET = c => c.env.DB.prepare('PRIVATE_NATIVE_API_SQL').all(); export const POST = c => c.env.SECRET;`,
    `export default c => c.env.DB.prepare('PRIVATE_NATIVE_API_SQL').all(); export const GET = c => c.env.SECRET;`,
    `const handler = c => c.env.DB.prepare('PRIVATE_NATIVE_API_SQL').all(); export default handler;`,
    `export default function handler(c) { return c.env.SECRET; }`,
])('removes native handler bodies and preserves their runtime exports: %s', async source => {
    const output = await load(fixture(source));
    expect(output).toBeTypeOf('string');
    expect(output).not.toContain('PRIVATE_NATIVE_API_SQL'); expect(output).not.toContain('c.env');
    const module = await import(`data:text/javascript,${encodeURIComponent(output)}`);
    for (const name of source.includes('export const GET') ? ['GET', ...(source.includes('POST') ? ['POST'] : [])] : []) {
        expect(() => module[name]()).toThrow(/server-only.*HTTP|HTTP.*server-only/);
    }
    if (source.includes('export default')) expect(() => module.default()).toThrow(/server-only.*HTTP|HTTP.*server-only/);
});
it('keeps native handler modules unchanged in the SSR environment', async () => {
    expect(await load(fixture(`export const GET=c=>c.env.SECRET;`), 'ssr')).toBeUndefined();
});
it('does not stub page components or unrelated modules that happen to export GET', async () => {
    expect(await load(fixture(`import {Cossack,Page} from '@cossackframework/core'; @Page() export default class PageComponent extends Cossack {render(){return 'page';}}`))).toBeUndefined();
    expect(await load(fixture(`export const GET=()=>1;`, false))).toBeUndefined();
});
it('preserves explicit aliases and string export names without importing their dependencies', async () => {
    const source = `const handler=c=>c.env.SECRET; export {handler as GET,handler as "metadata-key"};`;
    const output = await load(fixture(source));
    const module = await import(`data:text/javascript,${encodeURIComponent(output)}`);
    expect(Object.keys(module)).toEqual(['GET', 'metadata-key']);
    expect(() => module['metadata-key']()).toThrow(/server-only/);
});
it('refuses ambiguous runtime export stars with a route-specific diagnostic', async () => {
    await expect(load(fixture(`export const GET=c=>c.env.SECRET; export * from './private';`)))
        .rejects.toThrow(/Server-only HTTP route.*export \*/);
});
