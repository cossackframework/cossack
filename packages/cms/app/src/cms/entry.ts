import type { Context } from 'hono';
import { networkFor } from './index';
import { runNetworkMaintenance } from './maintenance';
import { pluginRouteActive } from './middleware';

/**
 * The CMS's options for `createApp` in a project's `src/index.ts`: a rendered plugin's pages
 * and handlers answer only while the plugin is active in the CMS.
 */
export const cmsAppOptions: { isPluginActive(plugin: string, c: Context): Promise<boolean> } = { isPluginActive: pluginRouteActive };

/**
 * The Worker's `scheduled` handler: recover unconfirmed writes, deliver outbox events and keep
 * the Cloud database warm, on each site in turn.
 */
export function cmsScheduled(env: unknown, ctx: { waitUntil(work: Promise<unknown>): void }): void {
    ctx.waitUntil(runNetworkMaintenance(networkFor(env as never), { warm: true }));
}

/** The Node server's background work: the same maintenance, every minute in the server process. */
export function startCmsMaintenance(env: unknown): void {
    const maintenance = setInterval(() => {
        runNetworkMaintenance(networkFor(env as never)).catch(error => console.error('[cms] maintenance failed', error));
    }, 60_000);
    maintenance.unref();
}
