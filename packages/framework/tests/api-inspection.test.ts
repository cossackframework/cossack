// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectApiContractsFromAst, isHttpHandlerModule } from '../src/page-inspection';
import { cossackSecurityPlugin } from '../src/vite-security-plugin';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each([
    `import {defineApi as endpoint} from '@cossackframework/framework/api'; export default endpoint({input:{body:privateSchema},output:privateOutput,authorize:privateGuard,handler:privateHandler});`,
    `import * as api from '@cossackframework/framework/api'; const definition={input:{body:privateSchema},output:privateOutput,authorize:privateGuard,handler:privateHandler}; const handler=api.defineApi(definition); export {handler as default};`,
    `import {defineApi} from '@cossackframework/framework/api'; const make=defineApi; const handler=make({input:{body:privateSchema},output:privateOutput,authorize:privateGuard,handler:privateHandler}); const alias=handler; export default (alias satisfies unknown);`,
])('resolves API factory aliases without evaluating contracts (%#)', async source => {
    expect(await isHttpHandlerModule(source)).toBe(true);
    const facts = await inspectApiContractsFromAst(source, '/src/pages/api/save.ts');
    expect(facts.status).toBe('resolved'); expect(facts.methods).toEqual([expect.objectContaining({ method: '*', declaration: 'defineApi',
        inputLocations: ['body'], output: 'json', authorization: 'declared', source: { file: '/src/pages/api/save.ts', line: 1 } })]);
});

it('models effective default precedence and named export aliases', async () => {
    const source = `import {defineApi as api} from '@cossackframework/framework/api';
        const get=api({handler: () => new Response()}); export {get as GET};
        export const POST=api({input:{params:p,query:q},output:o,handler:save});`;
    const named = await inspectApiContractsFromAst(source);
    expect(named.methods).toEqual([expect.objectContaining({ method: 'GET', declaration: 'defineApi', inputLocations: [], output: 'response', authorization: 'none' }),
        expect.objectContaining({ method: 'POST', inputLocations: ['params', 'query'], output: 'json' })]);
    const fallback = await inspectApiContractsFromAst(source + '\nexport default (c) => c.text("all");');
    expect(fallback.methods).toHaveLength(1); expect(fallback.methods[0]).toMatchObject({ method: '*', declaration: 'unvalidated', output: 'unknown' });
});

it.each(['privateDefinition', '{...privateDefinition}', '{input:privateInput,handler:save}', '{input:{...privateInput},handler:save}'])('reports dynamic contract details as unknown (%s)', async definition => {
    const source = `import {defineApi} from '@cossackframework/framework/api'; export const POST=defineApi(${definition});`;
    expect(await isHttpHandlerModule(source)).toBe(true);
    const facts = await inspectApiContractsFromAst(source);
    expect(facts.methods[0]).toMatchObject({ declaration: 'defineApi', inputLocations: null, reason: expect.stringContaining('unknown') });
});

it.each([
    `import type {defineApi} from '@cossackframework/framework/api'; export default defineApi({handler:save});`,
    `import {type defineApi} from '@cossackframework/framework/api'; export default defineApi({handler:save});`,
    `import {defineApi} from 'another-library'; export default defineApi({handler:save});`,
    `function defineApi(x){return x;} export default defineApi({handler:save});`,
    `import {defineApi} from '@cossackframework/framework/api'; export default class Component {}`,
])('does not invent declarations for foreign factories or type imports (%#)', async source => {
    expect(await isHttpHandlerModule(source)).toBe(false);
    expect((await inspectApiContractsFromAst(source)).status).toBe('unknown');
});

it('keeps named handlers with exported helper classes and ignores type-only HTTP names', async () => {
    expect(await isHttpHandlerModule('export class Helper {} export const GET = (c) => c.text("ok");')).toBe(true);
    expect(await isHttpHandlerModule('export type GET = string; export interface POST {}')).toBe(false);
});

it('keeps mutable named exports server-only without asserting their initial contract', async () => {
    const source = `import {defineApi} from '@cossackframework/framework/api';
        export let POST=defineApi({input:{body:schema},output:schema,handler:save}); POST=otherHandler;`;
    expect(await isHttpHandlerModule(source)).toBe(true);
    expect((await inspectApiContractsFromAst(source)).methods[0]).toMatchObject({ declaration: 'unknown', inputLocations: null,
        output: 'unknown', authorization: 'unknown' });
});

it('strips API factories and all private initializers before the client dependency graph loads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cossack-api-security-')); roots.push(root);
    const directory = join(root, 'src/pages/(private)/api'); mkdirSync(directory, { recursive: true });
    const file = join(directory, 'save.ts');
    const source = `import * as api from '@cossackframework/framework/api';
        import {schema} from './private-schema'; import {connect} from 'node:net';
        const privateKey='private-api-key'; const dependency=connect(privateKey);
        const handler=api.defineApi({input:{body:schema},output:schema,handler:()=>dependency}); export {handler as default};`;
    writeFileSync(file, source);
    const plugin = cossackSecurityPlugin();
    const stub = await (plugin.load as Function).call({ environment: { name: 'client' } }, file + '?import');
    expect(stub).toContain('export default');
    for (const privateText of ['private-api-key', 'private-schema', 'node:net', 'defineApi']) expect(stub).not.toContain(privateText);
    expect(await (plugin.load as Function).call({ environment: { name: 'ssr' } }, file)).toBeUndefined();
});
