import { networkSite, type CmsHost, type CmsNetwork } from '@cossackframework/cms/server';

/** Where the last scheduled run stopped among the added sites, in the main site's cache. */
const CURSOR = 'network:maintenance-cursor';

/**
 * The scheduled run: the main site, then the added sites in turn from where the last run
 * stopped, within a time budget. Scheduled publishing, the outbox, webhooks and write recovery
 * so also run on sites nobody visits.
 */
export async function runNetworkMaintenance(network: CmsNetwork, options: { warm?: boolean; budgetMs?: number } = {}): Promise<void> {
    const started = Date.now();
    await runMaintenance(network.main, options);
    if (!network.multisite || !(await network.main.installed())) return;
    let cursor = (await network.main.cache.get<string>(CURSOR)) ?? '';
    for (const site of await network.sites.inTurn(cursor)) {
        if (Date.now() - started > (options.budgetMs ?? 20_000)) break;
        await runMaintenance(network.hostOf(networkSite(site)), options).catch(error => console.error(`[cms] maintenance of site ${site.id} failed`, error));
        cursor = site.id;
    }
    await network.main.cache.set(CURSOR, cursor);
}

/**
 * Background upkeep: recover unconfirmed writes by exact replay, publish scheduled entries,
 * deliver outbox events and webhooks, prune delivered events, expired sessions, reset tokens,
 * preview links, sign-in challenges, old autosaves and form records, empty forms' old trash, and
 * finish interrupted uploads.
 * `warm` asks RomeDB Cloud to start the database; request paths never warm, so run it from a schedule.
 */
export async function runMaintenance(cms: CmsHost, options: { warm?: boolean } = {}): Promise<void> {
    if (options.warm) await cms.db.warm().catch(() => undefined);
    // A fresh database has no host tables until setup applies the schema.
    if (!(await cms.installed())) return;
    await cms.db.recoverPending({ limit: 50 });
    await cms.publishDue();
    await cms.outbox.dispatch({ limit: 50 });
    await cms.webhooks.dispatch({ limit: 20 });
    await cms.outbox.prune();
    await cms.webhooks.prune();
    await cms.sessions.purgeExpired();
    await cms.oauthStates.purgeExpired(Date.now());
    await cms.accounts.purgeExpiredResets();
    await cms.previews.purgeExpired();
    await cms.security.purgeExpired();
    await cms.autosaves.purge();
    await cms.traffic.prune();
    await cms.forms.maintain();
    await cms.files?.sweep();
}
