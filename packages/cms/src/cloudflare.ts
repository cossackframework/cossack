/**
 * Cloudflare-only pieces of isolated plugins (specs/cms-plugin-isolation.md). Import this
 * module from the Worker entry only: it imports `cloudflare:workers`.
 *
 * ```ts
 * import { cloudflarePluginRunner, createPluginBridge, PluginTail } from '@cossackframework/cms/cloudflare';
 * setPluginRunner(cloudflarePluginRunner());
 * export const PluginBridge = createPluginBridge((env, site) => networkFor(env).hostById(site));
 * export { PluginTail };
 * ```
 */
import { env, exports, WorkerEntrypoint } from 'cloudflare:workers';
import { CmsError } from './errors';
import type { CmsHost } from './server/host';
import { workerLoaderRunner, type BridgeProps, type IsolateLimits, type IsolatedWork, type LoopbackExports, type PluginRunner, type WorkerLoaderLike } from './server/isolation';

/** The runner over the application's Worker Loader binding, or null when it has none. */
export function cloudflarePluginRunner(options: { binding?: string; compatibilityDate?: string; limits?: Partial<Record<IsolatedWork, IsolateLimits>> } = {}): PluginRunner | null {
    const loader = (env as unknown as Record<string, unknown>)[options.binding ?? 'LOADER'] as WorkerLoaderLike | undefined;
    if (!loader || typeof loader.get !== 'function') return null;
    return workerLoaderRunner({
        loader,
        exports: () => exports as unknown as LoopbackExports,
        ...(options.compatibilityDate ? { compatibilityDate: options.compatibilityDate } : {}),
        ...(options.limits ? { limits: options.limits } : {}),
    });
}

/**
 * The application's `PluginBridge`: what an isolated plugin's Worker calls back. Its props
 * come from the host and the plugin cannot see them; `open` finds the host of the site named there.
 */
export function createPluginBridge<Env = unknown>(open: (env: Env, site: string) => CmsHost | null | Promise<CmsHost | null>) {
    return class PluginBridge extends WorkerEntrypoint<Env, BridgeProps> {
        async call(member: string, args: readonly unknown[]): Promise<unknown> {
            const props = this.ctx.props;
            // A call the host stopped waiting for gets nothing more.
            if (Date.now() > props.deadline) throw new CmsError('CMS_UNAVAILABLE', `This call to plugin ${props.plugin} has ended.`);
            const host = await open(this.env, props.site);
            if (!host) throw new CmsError('CMS_NOT_FOUND', `Site ${props.site} is not available.`);
            await host.ready();
            return host.isolatedCall(props.plugin, member, args, props.principals);
        }
    };
}

interface TailEvent {
    readonly logs?: readonly { readonly level: string; readonly message: readonly unknown[] }[];
    readonly exceptions?: readonly { readonly name: string; readonly message: string }[];
}

/** Writes an isolated plugin's console output and uncaught errors to the application's log, named. */
export class PluginTail extends WorkerEntrypoint<unknown, { plugin: string }> {
    tail(events: readonly unknown[]): void {
        const prefix = `[plugin ${this.ctx.props.plugin}]`;
        for (const event of events as readonly TailEvent[]) {
            for (const log of event.logs ?? []) (log.level === 'error' ? console.error : log.level === 'warn' ? console.warn : console.log)(prefix, ...log.message);
            for (const exception of event.exceptions ?? []) console.error(prefix, `${exception.name}: ${exception.message}`);
        }
    }
}
