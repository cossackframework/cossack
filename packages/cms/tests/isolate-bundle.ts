import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const CMS = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const ISOLATE = fileURLToPath(new URL('../src/isolate.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/isolated-desk/', import.meta.url));

/** Bundle one module as the framework would for a Worker: platform modules stay imports, the package resolves to its source. */
export async function bundleModule(entry: string): Promise<string> {
    const build = await rolldown({
        input: 'entry',
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        platform: 'neutral',
        external: ['cloudflare:workers', 'node:async_hooks'],
        resolve: { conditionNames: ['workerd', 'worker', 'browser', 'import', 'module', 'default'], mainFields: ['module', 'main'], alias: { '@cossackframework/cms': CMS } },
        plugins: [{ name: 'entry', resolveId: (id: string) => id === 'entry' ? id : null, load: (id: string) => id === 'entry' ? entry : null }],
        logLevel: 'silent',
    });
    try {
        const { output } = await build.generate({ format: 'esm', codeSplitting: false });
        return output[0].code;
    } finally {
        await build.close();
    }
}

/** The isolated-desk fixture as its Worker's module: what the framework's `pluginIsolation` produces. */
export function bundleFixturePlugin(): Promise<string> {
    return bundleModule(`import * as plugin from ${JSON.stringify(`${FIXTURE}server.ts`)};
import manifest from ${JSON.stringify(`${FIXTURE}plugin.json`)};
import isolate from ${JSON.stringify(ISOLATE)};
export default isolate(plugin, manifest);`);
}
