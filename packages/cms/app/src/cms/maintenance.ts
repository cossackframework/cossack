import type { CmsHost } from '@cossackframework/cms/server';

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
    await cms.users.purgeExpiredResets();
    await cms.previews.purgeExpired();
    await cms.security.purgeExpired();
    await cms.autosaves.purge();
    await cms.traffic.prune();
    await cms.forms.maintain();
    await cms.files?.sweep();
}
