import { AsyncLocalStorage } from 'node:async_hooks';
import { createIsolateRuntime, type CurrentCall, type IsolateRuntime } from '../src/isolate-core';
import type { CmsPluginManifest } from '../src/manifest';
import type { CmsHost } from '../src/server/host';
import type { BridgeProps, IsolatedWork, PluginRunner } from '../src/server/isolation';
import type { IsolateCall } from '../src/isolation';

/** What crosses into a Worker: copies, as workerd makes them. Requests and responses cross as themselves. */
const copy = <T>(value: T): T => value instanceof Request || value instanceof Response ? value : structuredClone(value);

/** An isolated plugin's registration: no module in the application, only its bundle. */
export function isolatedRegistration(manifest: CmsPluginManifest) {
    return { name: manifest.name, version: manifest.version, manifest, module: null, isolation: { mode: 'isolated' as const, code: `/* ${manifest.name} in process */`, hash: `${manifest.name}-test-hash` } };
}

/**
 * Runs isolated plugins in this process through the same runtime their Workers use, with
 * every argument and result copied, and the bridge checking the deadline as `PluginBridge` does.
 */
export function inProcessRunner(plugins: Record<string, { readonly module: Readonly<Record<string, unknown>>; readonly manifest: CmsPluginManifest }>, hostFor: (site: string) => CmsHost) {
    const runtimes = new Map<string, IsolateRuntime>();
    const calls: { plugin: string; call: IsolateCall; props: BridgeProps; work: IsolatedWork }[] = [];
    const runner: PluginRunner = {
        async run(plugin, call, props, work) {
            calls.push({ plugin: plugin.name, call, props, work });
            const entry = plugins[plugin.name];
            if (!entry) throw new Error(`No module for ${plugin.name}.`);
            let runtime = runtimes.get(plugin.name);
            if (!runtime) { runtime = createIsolateRuntime(entry.module, entry.manifest, new AsyncLocalStorage<CurrentCall>()); runtimes.set(plugin.name, runtime); }
            const bridge = {
                async call(member: string, args: readonly unknown[]) {
                    if (Date.now() > props.deadline) throw Object.assign(new Error(`This call to plugin ${props.plugin} has ended.`), { code: 'CMS_UNAVAILABLE' });
                    return copy(await hostFor(props.site).isolatedCall(props.plugin, member, args.map(copy), copy(props.principals)));
                },
            };
            return copy(await runtime.run(copy(call), bridge as never));
        },
    };
    return { runner, calls };
}
