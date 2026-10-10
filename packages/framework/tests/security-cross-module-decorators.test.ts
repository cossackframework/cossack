import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    cossackSecurityPlugin,
    inspectCompilerMethods,
    isClientSafeMethod,
    stripClientServerOnlyImports,
    transformCossackClass,
} from '../src/vite-security-plugin';

const ID = '/src/pages/counter.ts';
const transform = (source: string) => stripClientServerOnlyImports(
    transformCossackClass(source, ID, isClientSafeMethod, new Set(['render']), false), ID);

const page = (imports: string, decorator: string, prelude = '') => `${imports}
import {Page} from '@cossackframework/core';
${prelude}
const privateInput = (value: unknown) => { if (value !== 'PRIVATE_INPUT_TOKEN') throw new Error('bad'); return value; };
const privateGate = () => 'PRIVATE_AUTHORIZE_TOKEN' === 'x';
@Page() class Counter {
  @${decorator}({ input: privateInput, authorize: privateGate })
  async increment(value: string) { return 'PRIVATE_SERVER_BODY_TOKEN' + value; }
  render() { return 'public'; }
}`;

describe('typed decorators imported from a shared module', () => {
    it.each([
        ['import {channel} from "./rpc";', 'channel.Server'],
        ['import {channel as ch} from "../rpc";', 'ch.Server'],
        ['import * as rpc from "./rpc";', 'rpc.channel.Server'],
        ['import {Server as RpcServer} from "./rpc";', 'RpcServer'],
        ['import {Server} from "~/rpc";', 'Server'],
        ['import {channel} from "./rpc";', 'Typed', 'const Typed = channel.Server;'],
        ['import {channel} from "./rpc";', 'Typed', 'const {Server: Typed} = channel;'],
        ['import {channel} from "./rpc";', '(channel.Server)'],
        ['import {channel} from "./rpc";', '(channel["Server"])'],
    ])('strips the server body and input/authorize closures (%#)', (imports, decorator, prelude = '') => {
        const source = page(imports, decorator, prelude);
        const client = transform(source);
        expect(client).not.toContain('PRIVATE_SERVER_BODY_TOKEN');
        expect(client).not.toContain('PRIVATE_INPUT_TOKEN');
        expect(client).not.toContain('PRIVATE_AUTHORIZE_TOKEN');
        expect(client).not.toContain('privateInput');
        expect(client).not.toContain('privateGate');
        expect(client).toContain('input: undefined');
        expect(client).toContain('authorize: undefined');
        expect(client).toContain("__cossack_proxies?.get('increment')");
        const method = inspectCompilerMethods(source, ID).classes[0].methods.find(m => m.name === 'increment');
        expect(method).toMatchObject({ clientBody: 'stripped', rpc: 'explicit' });
    });

    it('treats @x.Server on an undecorated class as a framework class', () => {
        const client = transform(`import {channel} from './rpc';
class Widget { @channel.Server() load() { return 'PRIVATE_SERVER_BODY_TOKEN'; } }`);
        expect(client).not.toContain('PRIVATE_SERVER_BODY_TOKEN');
    });
});

describe('client source maps of stripped modules', () => {
    const source = page('import {channel} from "./rpc";', 'channel.Server');

    it('returns a map whose sourcesContent is the stripped output', () => {
        const plugin = cossackSecurityPlugin();
        const result = (plugin.transform as Function).call({ environment: { name: 'client' } }, source, `${ID}?import`);
        expect(result.code).not.toContain('PRIVATE_SERVER_BODY_TOKEN');
        expect(result.map).not.toBeNull();
        expect(result.map.sourcesContent).toEqual([result.code]);
        expect(JSON.stringify(result.map)).not.toContain('PRIVATE_');
        expect(result.map.mappings.split(';')).toHaveLength(result.code.split('\n').length);
    });

    const root = mkdtempSync(join(tmpdir(), 'cossack-smap-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('does not leak stripped bodies into emitted client .map files', async () => {
        mkdirSync(join(root, 'src/pages'), { recursive: true });
        writeFileSync(join(root, 'src/rpc.ts'), `import {createTypedDecorators} from '@cossackframework/core';\nexport const channel = createTypedDecorators<{count:number}>();\n`);
        writeFileSync(join(root, 'src/pages/counter.ts'), `${source}\nexport { Counter };\n`.replace('"./rpc"', '"../rpc"'));
        writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { experimentalDecorators: true, target: 'es2022' } }));
        await build({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [cossackSecurityPlugin({ devWarning: false })],
            build: {
                sourcemap: true,
                minify: false,
                outDir: 'dist',
                lib: { entry: 'src/pages/counter.ts', formats: ['es'] },
                rollupOptions: { external: [/^@cossackframework\//] },
            },
        });
        const maps = readdirSync(join(root, 'dist')).filter(file => file.endsWith('.map'));
        expect(maps.length).toBeGreaterThan(0);
        for (const file of maps) {
            const map = readFileSync(join(root, 'dist', file), 'utf8');
            expect(map).toContain('render');
            expect(map).not.toContain('PRIVATE_');
        }
        for (const file of readdirSync(join(root, 'dist')).filter(file => file.endsWith('.js'))) {
            expect(readFileSync(join(root, 'dist', file), 'utf8')).not.toContain('PRIVATE_');
        }
    });
});
