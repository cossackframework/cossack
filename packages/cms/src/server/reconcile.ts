import type { PendingWrite, Reconciler } from '@cossackframework/romedb';

/**
 * Reconcilers for CMS writes that left RomeDB's 64-request receipt window unconfirmed.
 * A resource write committed exactly when its audit row (keyed by the operation ID) exists.
 * Host ledgers (sessions, outbox, files, migrations) are fenced or re-planned, so their
 * unconfirmed writes are dropped once replay is impossible.
 */
export function cmsReconcilers(): { [kind: string]: Reconciler } {
    const drop: Reconciler = async () => 'absent';
    return {
        'cms.resource.write': async (write: PendingWrite, db) => {
            const { requestId } = JSON.parse(write.request.body) as { requestId: string };
            const result = await db.read([{ rql: 'SELECT 1 FROM cms_audit WHERE id = $id', params: { $id: requestId } }]);
            return result.results[0]!.rows.length ? 'committed' : 'absent';
        },
        // A submission committed exactly when its send row exists.
        'cms.forms.submit': async (write: PendingWrite, db) => {
            const { requestId } = JSON.parse(write.request.body) as { requestId: string };
            const result = await db.read([{ rql: 'SELECT 1 FROM cms_form_sends WHERE id = $id', params: { $id: requestId } }]);
            return result.results[0]!.rows.length ? 'committed' : 'absent';
        },
        'cms.forms': drop,
        'cms.migration': drop, 'cms.session': drop, 'cms.auth.session': drop, 'cms.auth.oauth': drop, 'cms.users': drop,
        'cms.outbox': drop, 'cms.files': drop, 'cms.jobs': drop, 'cms.notifications': drop,
    };
}
