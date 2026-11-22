/**
 * The stores the framework's jobs and notifications keep in the site's database. Sessions,
 * OAuth states and what signs people in are the application's, with its accounts.
 */
import { createSqlJobStore, type JobStore } from '@cossackframework/core/jobs';
import { createSqlNotificationStore, type NotificationStore } from '@cossackframework/core/notifications';
import { rqlDatabase, type RomeDB } from '@cossackframework/romedb';

/** Job ledger with the same lease and fencing semantics as the D1 store. */
export function createJobStore(db: RomeDB): JobStore {
    return createSqlJobStore(rqlDatabase(db, { kind: 'cms.jobs' }));
}

/** Notification ledger with the same fencing semantics as the D1 store. */
export function createNotificationStore(db: RomeDB): NotificationStore {
    return createSqlNotificationStore(rqlDatabase(db, { kind: 'cms.notifications' }));
}
