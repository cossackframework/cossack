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
