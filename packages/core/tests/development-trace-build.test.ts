// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllEnvs());
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

it.each([['method-proxy', 'proxyHttpMethods'], ['service-scope', 'ServiceScope']])('removes trace collection from a production %s bundle', async (entry, symbol) => {
    vi.stubEnv('NODE_ENV', 'production');
    const output = await build({
        configFile: false, logLevel: 'silent', mode: 'production',
        build: {
            write: false, minify: false,
            lib: { entry: fileURLToPath(new URL(`../src/shared/${entry}.ts`, import.meta.url)), formats: ['es'] },
            rolldownOptions: { external: ['@cossackframework/renderer', 'hono', 'reflect-metadata'] },
        },
    });
    const bundles = Array.isArray(output) ? output : [output];
    const source = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
        .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(source).toContain(symbol);
    for (const marker of ['service-rpc', 'beginDevelopmentServiceRpcTrace', 'state-reconciled', 'startDevelopmentTrace', 'beginDevelopmentRpcTrace', 'Trace capacity must', 'registerDevelopmentInspector', 'developmentValueReader', 'Select at most 32']) {
        expect(source).not.toContain(marker);
    }
}, 30000);
