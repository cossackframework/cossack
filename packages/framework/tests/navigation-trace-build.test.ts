// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

afterEach(() => vi.unstubAllEnvs());
it('removes navigation trace capture and browser diagnostics from production output', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await build({ configFile: false, logLevel: 'silent', mode: 'production', build: {
        write: false, minify: false,
        lib: { entry: fileURLToPath(new URL('../src/client/navigation-diagnostics.ts', import.meta.url)), formats: ['es'] },
    } });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
        .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(code).toContain('createNavigationTrace');
    for (const marker of ['component-prepared', 'cossack:navigation-diagnostic', 'createDevelopmentNavigationTrace', 'startDevelopmentTrace']) {
        expect(code).not.toContain(marker);
    }
}, 30000);

it('removes the browser inspector, editor endpoint and capture controls from production output', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await build({ configFile: false, logLevel: 'silent', mode: 'production', build: {
        write: false, minify: false,
        lib: { entry: fileURLToPath(new URL('../src/client/devtools.ts', import.meta.url)), formats: ['es'] },
    } });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
        .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(code).toContain('enableDevTools');
    for (const marker of ['Cossack developer tools', 'localhost:3333', 'Record trace',
        'cossack-start:', 'startDevelopmentTrace', 'WeakRef', 'Component snapshot']) {
        expect(code).not.toContain(marker);
    }
}, 30000);

it('removes the project trace publisher from production output', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await build({ configFile: false, logLevel: 'silent', mode: 'production', build: {
        write: false, minify: false,
        lib: { entry: fileURLToPath(new URL('../src/client/development-trace-bridge.ts', import.meta.url)), formats: ['es'] },
    } });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
        .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(code).toContain('connectDevelopmentTraceBridge');
    for (const marker of ['cossack:development-trace', 'setInterval', 'Record trace', 'startDevelopmentTrace', 'localhost:3333']) expect(code).not.toContain(marker);
}, 30000);

it('removes server development evidence instrumentation from production output', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await build({ configFile: false, logLevel: 'silent', mode: 'production', build: {
        write: false, minify: false,
        lib: { entry: fileURLToPath(new URL('../src/transports/development-trace.ts', import.meta.url)), formats: ['es'] },
    } });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
        .filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(code).toContain('developmentRpcEvidence');
    for (const marker of ['X-Cossack-Development-Trace', 'finishedAt', 'receivedAt', 'invokedAt', 'randomUUID', 'cossack:development-rpc-evidence']) expect(code).not.toContain(marker);
}, 30000);

it('removes server stream evidence from the production response encoder', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result=await build({configFile:false,logLevel:'silent',mode:'production',build:{write:false,minify:false,
        lib:{entry:fileURLToPath(new URL('../src/transports/rpc-stream.ts',import.meta.url)),formats:['es']},
        rolldownOptions:{external:['node:async_hooks','@cossackframework/core']}}});
    const bundles=Array.isArray(result)?result:[result];
    const code=bundles.flatMap(bundle=>'output' in bundle?bundle.output:[]).filter(chunk=>chunk.type==='chunk').map(chunk=>chunk.code).join('\n');
    expect(code).toContain('createRpcStreamResponse');expect(code).not.toContain('developmentTrace');
},30000);
