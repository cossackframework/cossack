import { isCmsError, systemPrincipal } from '@cossackframework/cms';
import { networkSite, type CmsHost, type CmsNetwork } from '@cossackframework/cms/server';

/** Where the last scheduled run stopped among the added sites, in the network's state. */
const CURSOR = 'maintenance.cursor';
/** How many entries with notes one run checks, and where the next run continues (per process; starting over is harmless). */
const NOTED_ENTRIES = 50;
let notedCursor = 0;

/**
 * The scheduled run: the main site, then the added sites in turn from where the last run
 * stopped, within a time budget. Scheduled publishing, the outbox, webhooks and write recovery
 * so also run on sites nobody visits.
 */
export async function runNetworkMaintenance(network: CmsNetwork, options: { warm?: boolean; budgetMs?: number } = {}): Promise<void> {
    const started = Date.now();
    await runMaintenance(network.main, options);
    if (!network.multisite || !(await network.main.installed())) return;
    await network.handoffs.purgeExpired();
    // Sites deleted 30 days ago lose their database and media.
    await network.purgeDeleted().catch(error => console.error('[cms] could not purge deleted sites', error));
    // Off, the network serves its main site only.
    if (!(await network.enabled())) return;
    let cursor = (await network.state<string>(CURSOR)) ?? '';
    for (const site of await network.sites.inTurn(cursor)) {
        if (Date.now() - started > (options.budgetMs ?? 20_000)) break;
        await runMaintenance(network.hostOf(networkSite(site)), options).catch(error => console.error(`[cms] maintenance of site ${site.id} failed`, error));
        cursor = site.id;
    }
    await network.setState(CURSOR, cursor);
}

/**
 * Background upkeep: recover unconfirmed writes by exact replay, publish scheduled entries,
 * deliver outbox events and webhooks, prune delivered events, expired sessions, reset tokens,
 * preview links, sign-in challenges and ended attempt counts, old autosaves and form records, empty forms' old trash, and
 * finish interrupted uploads.
 * `warm` asks RomeDB Cloud to start the database; request paths never warm, so run it from a schedule.
 */
export async function runMaintenance(cms: CmsHost, options: { warm?: boolean } = {}): Promise<void> {
    if (options.warm) await cms.db.warm().catch(() => undefined);
    // A fresh database has no host tables until setup applies the schema.
    if (!(await cms.installed())) return;
    // Recovery failing (an unreadable store, an unreachable database) must not stop the rest of upkeep.
    const recovery = await cms.db.recoverPending({ limit: 50 }).catch(error => {
        console.error('[cms] recovering unconfirmed writes failed', error);
        return null;
    });
    if (recovery?.unreadable.length) console.warn(`[cms] ${recovery.unreadable.length} unconfirmed write(s) could not be read: ${recovery.unreadable.join(', ')}`);
    // Each step runs whatever the others do: one failing (a plugin refusing a scheduled entry,
    // a webhook endpoint down) must not hold back the rest of upkeep.
    for (const step of [
        () => cms.runSchedule(),
        () => cms.schedules.tick(),
        () => cms.outbox.dispatch({ limit: 50 }),
        () => cms.webhooks.dispatch({ limit: 20 }),
        () => cms.outbox.prune(),
        () => cms.webhooks.prune(),
        () => cms.sessions.purgeExpired(),
        () => cms.oauthStates.purgeExpired(Date.now()),
        () => cms.accounts.purgeExpiredResets(),
        () => cms.previews.purgeExpired(),
        () => cms.security.purgeExpired(),
        () => cms.security.purgeAttempts(),
        () => cms.autosaves.purge(),
        () => cms.drafts.purge(),
        () => purgeOrphanNotes(cms),
        () => cms.traffic.prune(),
        () => cms.audit.prune(),
        () => cms.forms.maintain(),
        () => cms.files?.sweep(),
    ]) {
        try { await step(); } catch (error) {
            // An unreachable database fails every step alike: the next run tries again.
            if (isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            console.error('[cms] a maintenance step failed', error);
        }
    }
}

/** Notes of entries that no longer exist go with them: a slice of the noted entries is checked per run, the next run takes the next slice. */
async function purgeOrphanNotes(cms: CmsHost): Promise<void> {
    const entries = await cms.notes.entries(NOTED_ENTRIES, notedCursor).catch(() => []);
    notedCursor = entries.length < NOTED_ENTRIES ? 0 : notedCursor + entries.length;
    const principal = systemPrincipal('maintenance');
    for (const entry of entries) {
        let exists = true;
        // A resource the host no longer declares (a plugin turned off) keeps its notes for its return.
        try { exists = (await cms.resource(entry.resource).get(entry.recordId, { principal })) !== null; } catch { exists = true; }
        if (!exists) await cms.notes.purgeEntry(entry.resource, entry.recordId).catch(() => undefined);
    }
}
