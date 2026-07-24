/**
 * The app re-uses the framework's SessionRow type (from
 * @cossackframework/database), which declares the `sessions` table on the
 * Kysely Database interface and now includes `created_at` (added in migration
 * 0008). Re-export so app code can import it from the usual models location.
 *
 * We do NOT re-augment `Database.sessions` here — the framework owns that
 * declaration; a second one would conflict (TS2717).
 */
export type { SessionRow } from '@cossackframework/database';
