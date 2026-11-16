/**
 * The entry of an isolated plugin's Worker. The framework bundles a plugin's `server.ts` as
 * `isolate(exports, manifest)` (the `pluginIsolation` option), and the host calls the class
 * it returns with `run(call, bridge)`. Only bundled into isolates: it imports platform modules.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createIsolateRuntime, type CurrentCall } from './isolate-core';
import type { IsolateBridge, IsolateCall, IsolateEntrypoint } from './isolation';
import type { CmsPluginManifest } from './manifest';

export default function isolate(plugin: Readonly<Record<string, unknown>>, manifest: CmsPluginManifest) {
    const runtime = createIsolateRuntime(plugin, manifest, new AsyncLocalStorage<CurrentCall>());
    return class PluginIsolate extends WorkerEntrypoint implements IsolateEntrypoint {
        run(call: IsolateCall, bridge: IsolateBridge): Promise<unknown> {
            return runtime.run(call, bridge);
        }
    };
}
