/**
 * Relational host tables. The host owns the `cms_` and `cossack_` namespaces; plugins
 * never create tables. Each host step is versioned and applies once through the ledger,
 * and fits one batch (32 statements, including the ledger row). The steps create today's
 * tables; a later change is a new step after them. A database whose ledger names a step this
 * build does not have was made by another build, and the host refuses it (`unknownHostSteps`).
 */
import type { Statement } from '@cossackframework/romedb';
import { jobStateSchema } from '@cossackframework/core/jobs';
import { notificationStateSchema } from '@cossackframework/core/notifications';

export interface HostStep {
    readonly version: number;
    readonly description: string;
    readonly statements: readonly Statement[];
}

const split = (script: string): Statement[] => script.split(';').map(rql => rql.trim()).filter(Boolean)
    .map(rql => ({ rql: rql.replace(/\bIF NOT EXISTS\s+/g, '') }));

export const HOST_TABLES = [
    'cms_migrations', 'cms_schema_state', 'cms_users', 'cms_roles', 'cms_user_roles', 'cms_auth_sessions', 'cms_oauth_states',
    'cms_password_resets', 'cms_sessions', 'cms_session_values', 'cms_grants', 'cms_audit', 'cms_revisions', 'cms_outbox', 'cms_files',
    'cms_terms', 'cms_settings', 'cms_collections', 'cms_taxonomies', 'cms_field_groups', 'cms_menus', 'cms_menu_locations',
    'cms_preview_tokens', 'cms_autosaves', 'cms_file_variants', 'cms_redirects', 'cms_api_tokens', 'cms_webhooks', 'cms_webhook_deliveries',
    'cms_comments', 'cms_user_security', 'cms_passkeys', 'cms_auth_challenges', 'cms_areas', 'cms_form_sends', 'cms_form_mail', 'cms_form_results', 'cms_crawler_visits', 'cms_not_found', 'cms_cache',
    'cms_accounts', 'cms_sites', 'cms_site_domains', 'cms_handoffs', 'cms_session_sites', 'cms_memberships', 'cms_network', 'cossack_jobs', 'cossack_notifications',
    'cms_drafts', 'cms_notes', 'cms_note_mentions', 'cms_schedules', 'cms_automations', 'cms_registrations', 'cms_search', 'cms_attempts', 'cms_schema_generations',
] as const;

export const HOST_STEPS: readonly HostStep[] = [{
    version: 1,
    description: 'Core tables: the ledger, members, roles, sessions, grants, the audit trail, revisions and the outbox',
    statements: [
        { rql: `CREATE TABLE cms_migrations (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('host','additive','explicit')), owner TEXT NOT NULL,
            resource TEXT, version INTEGER NOT NULL, declaration_hash TEXT, rql TEXT NOT NULL, engine_version TEXT NOT NULL, applied_at INTEGER NOT NULL)` },
        { rql: 'CREATE TABLE cms_schema_state (resource TEXT PRIMARY KEY, declaration_hash TEXT NOT NULL, updated_at INTEGER NOT NULL)' },
        // A site's members. Accounts sign in (cms_accounts, the network database's); members keep the same ID. The slug names their author page.
        { rql: `CREATE TABLE cms_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT,
            status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            last_sign_in_at INTEGER, meta TEXT NOT NULL DEFAULT '{}', slug TEXT)` },
        { rql: 'CREATE INDEX cms_users_created ON cms_users (created_at)' },
        { rql: 'CREATE INDEX cms_users_slug ON cms_users (slug)' },
        { rql: 'CREATE TABLE cms_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL, created_at INTEGER NOT NULL)' },
        { rql: 'CREATE TABLE cms_user_roles (user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (user_id, role_id))' },
        { rql: 'CREATE INDEX cms_user_roles_role ON cms_user_roles (role_id)' },
        // Keyed by the session token, so rotation is one conditional update of the key. On a site other than the main one, a
        // session is a child of a network session: its public reference, and the network role copied at the handoff.
        { rql: `CREATE TABLE cms_auth_sessions (id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, user_agent TEXT, parent_id TEXT, network_role TEXT)` },
        { rql: 'CREATE INDEX cms_auth_sessions_user ON cms_auth_sessions (user_id, expires_at)' },
        { rql: 'CREATE INDEX cms_auth_sessions_parent ON cms_auth_sessions (parent_id)' },
        { rql: 'CREATE TABLE cms_oauth_states (key TEXT PRIMARY KEY, provider TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        // Keyed by the SHA-256 of the emailed token, so a database read cannot reset a password.
        { rql: 'CREATE TABLE cms_password_resets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_password_resets_user ON cms_password_resets (user_id)' },
        { rql: 'CREATE TABLE cms_sessions (id TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_sessions_expiry ON cms_sessions (expires_at)' },
        // One row per key, so concurrent writes to different keys never overwrite each other.
        { rql: 'CREATE TABLE cms_session_values (session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (session_id, key))' },
        { rql: `CREATE TABLE cms_grants (id TEXT PRIMARY KEY, subject TEXT NOT NULL, permission TEXT NOT NULL, revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE (subject, permission))` },
        { rql: `CREATE TABLE cms_audit (id TEXT PRIMARY KEY, actor TEXT, action TEXT NOT NULL, resource TEXT NOT NULL, record_id TEXT NOT NULL,
            revision INTEGER, at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_audit_record ON cms_audit (resource, record_id, at)' },
        { rql: `CREATE TABLE cms_revisions (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
            data TEXT NOT NULL, actor TEXT, at INTEGER NOT NULL, UNIQUE (resource, record_id, revision))` },
        { rql: `CREATE TABLE cms_outbox (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
            available_at INTEGER NOT NULL, attempts INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL,
            delivered_at INTEGER, pending_plugins TEXT)` },
        { rql: 'CREATE INDEX cms_outbox_ready ON cms_outbox (delivered_at, available_at)' },
    ],
}, {
    version: 2,
    description: 'Content tables: files, terms, settings, definitions, field groups, menus, areas, previews, autosaves, redirects, the cache, jobs and notifications',
    statements: [
        // Crop and focal point of an image as JSON (`edits`), and a tiny WebP of it as a data: URL, shown while it loads (`placeholder`).
        { rql: `CREATE TABLE cms_files (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, owner_id TEXT, name TEXT NOT NULL, content_type TEXT NOT NULL,
            size INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','ready','deleting')), title TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '',
            caption TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            edits TEXT, placeholder TEXT)` },
        { rql: 'CREATE INDEX cms_files_status ON cms_files (status, updated_at)' },
        { rql: 'CREATE INDEX cms_files_created ON cms_files (status, created_at)' },
        // The resized variants made of an image.
        { rql: 'CREATE TABLE cms_file_variants (key TEXT PRIMARY KEY, file_id TEXT NOT NULL, created_at INTEGER NOT NULL, size INTEGER)' },
        { rql: 'CREATE INDEX cms_file_variants_file ON cms_file_variants (file_id)' },
        // Materialized path of ancestor IDs, such as /a/b/: a subtree is one prefix match.
        { rql: `CREATE TABLE cms_terms (id TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            parent_id TEXT, path TEXT NOT NULL, depth INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            icon TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', UNIQUE (taxonomy, slug))` },
        { rql: 'CREATE INDEX cms_terms_path ON cms_terms (taxonomy, path)' },
        { rql: 'CREATE INDEX cms_terms_parent ON cms_terms (parent_id)' },
        { rql: 'CREATE TABLE cms_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        // Collection and taxonomy definitions made in the dashboard; built-ins store only what was added.
        { rql: 'CREATE TABLE cms_collections (name TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        { rql: 'CREATE TABLE cms_taxonomies (name TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        { rql: 'CREATE TABLE cms_field_groups (id TEXT PRIMARY KEY, definition TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        // A menu's items are one JSON tree, saved with a revision check.
        { rql: `CREATE TABLE cms_menus (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, items TEXT NOT NULL, revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)` },
        { rql: 'CREATE TABLE cms_menu_locations (location TEXT PRIMARY KEY, menu_id TEXT NOT NULL, updated_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_menu_locations_menu ON cms_menu_locations (menu_id)' },
        // A theme's widget area: its blocks as JSON, saved with a revision check.
        { rql: 'CREATE TABLE cms_areas (name TEXT PRIMARY KEY, blocks TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        // Keyed by the SHA-256 of the shared token, so a database read cannot preview anything.
        { rql: `CREATE TABLE cms_preview_tokens (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, created_by TEXT,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_preview_tokens_record ON cms_preview_tokens (resource, record_id)' },
        // One autosave per user and entry; `new` stands for an entry not saved yet.
        { rql: `CREATE TABLE cms_autosaves (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL,
            at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_autosaves_at ON cms_autosaves (at)' },
        { rql: `CREATE TABLE cms_redirects (id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, target TEXT NOT NULL, status INTEGER NOT NULL CHECK(status IN (301,302,307,308,410)),
            prefix INTEGER NOT NULL CHECK(prefix IN (0,1)), kind TEXT NOT NULL CHECK(kind IN ('auto','manual')), note TEXT NOT NULL DEFAULT '', hits INTEGER NOT NULL DEFAULT 0,
            last_hit_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT)` },
        { rql: 'CREATE INDEX cms_redirects_target ON cms_redirects (target)' },
        { rql: 'CREATE INDEX cms_redirects_prefix ON cms_redirects (prefix, updated_at)' },
        // JSON values by key; a NULL expiry keeps the value until it is deleted.
        { rql: 'CREATE TABLE cms_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)' },
        ...split(jobStateSchema),
        ...split(notificationStateSchema),
    ],
}, {
    version: 3,
    description: 'Sign-in, discussion, webhooks and forms',
    statements: [
        // Application passwords: the secret is stored as its SHA-256.
        { rql: `CREATE TABLE cms_api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('read','write')), created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER)` },
        { rql: 'CREATE INDEX cms_api_tokens_user ON cms_api_tokens (user_id, created_at)' },
        // Second factors: an authenticator app's secret, the last step it used, and recovery code hashes.
        { rql: `CREATE TABLE cms_user_security (user_id TEXT PRIMARY KEY, totp_secret TEXT, totp_confirmed_at INTEGER, totp_last_step INTEGER, recovery TEXT,
            updated_at INTEGER NOT NULL)` },
        { rql: `CREATE TABLE cms_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL,
            transports TEXT, device_type TEXT, backed_up INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER)` },
        { rql: 'CREATE INDEX cms_passkeys_user ON cms_passkeys (user_id)' },
        // Pending sign-ins and WebAuthn challenges, keyed by a random ID kept in a cookie.
        { rql: `CREATE TABLE cms_auth_challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, challenge TEXT NOT NULL, attempts INTEGER NOT NULL,
            expires_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_auth_challenges_expiry ON cms_auth_challenges (expires_at)' },
        { rql: `CREATE TABLE cms_comments (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, parent_id TEXT, user_id TEXT,
            author_name TEXT NOT NULL, author_email TEXT NOT NULL, author_url TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','approved','spam','trash')), ip_hash TEXT, user_agent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_comments_entry ON cms_comments (resource, record_id, status, created_at)' },
        { rql: 'CREATE INDEX cms_comments_status ON cms_comments (status, created_at)' },
        { rql: 'CREATE INDEX cms_comments_ip ON cms_comments (ip_hash, created_at)' },
        { rql: 'CREATE INDEX cms_comments_author ON cms_comments (author_email, status)' },
        { rql: `CREATE TABLE cms_webhooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, collections TEXT NOT NULL, secret TEXT NOT NULL,
            active INTEGER NOT NULL CHECK(active IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT)` },
        // One delivery per webhook and event, leased like outbox rows.
        { rql: `CREATE TABLE cms_webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')), attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, lease_token TEXT,
            lease_until INTEGER NOT NULL, response_status INTEGER, error TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER, UNIQUE (webhook_id, event_id))` },
        { rql: 'CREATE INDEX cms_webhook_deliveries_due ON cms_webhook_deliveries (status, next_attempt_at)' },
        { rql: 'CREATE INDEX cms_webhook_deliveries_hook ON cms_webhook_deliveries (webhook_id, created_at)' },
        // One row per form submission for a day: the write's receipt and the per-address throttle. Submissions live in each form's own table.
        { rql: 'CREATE TABLE cms_form_sends (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, ip_hash TEXT, at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_form_sends_ip ON cms_form_sends (form_id, ip_hash, at)' },
        { rql: 'CREATE INDEX cms_form_sends_at ON cms_form_sends (at)' },
        // Notification emails already sent, by event, rule and recipient, so outbox retries do not send them again.
        { rql: 'CREATE TABLE cms_form_mail (id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_form_mail_sent ON cms_form_mail (sent_at)' },
        // What a form post returns to the page after its redirect: the confirmation, or the errors and values. Read once.
        { rql: 'CREATE TABLE cms_form_results (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_form_results_expiry ON cms_form_results (expires_at)' },
    ],
}, {
    version: 4,
    description: 'The network: accounts, sites, domains, handoffs, memberships and network settings',
    statements: [
        // Who can sign in. Only the network database (the main site's) has rows; sites keep members in cms_users under the same ID.
        { rql: `CREATE TABLE cms_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, avatar TEXT,
            status TEXT NOT NULL CHECK(status IN ('active','disabled')), network_role TEXT CHECK(network_role IN ('network_admin')),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_sign_in_at INTEGER)` },
        { rql: 'CREATE INDEX cms_accounts_created ON cms_accounts (created_at)' },
        // Sites added to the network, each with its own database. Only the network database has rows; the main site has none.
        { rql: `CREATE TABLE cms_sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, database TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('creating','active','archived','deleted')), step TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)` },
        { rql: 'CREATE INDEX cms_sites_created ON cms_sites (created_at)' },
        // The host names a site answers on: one primary, the rest redirect to it. The main site's are under `main`.
        { rql: `CREATE TABLE cms_site_domains (host TEXT PRIMARY KEY, site_id TEXT NOT NULL, is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
            verified_at INTEGER, created_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_site_domains_site ON cms_site_domains (site_id, is_primary)' },
        // One-use codes that carry a network session to a site, keyed by the SHA-256 of the code.
        { rql: `CREATE TABLE cms_handoffs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, site_id TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_handoffs_expiry ON cms_handoffs (expires_at)' },
        // The sites each network session reached, so ending it ends their child sessions.
        { rql: 'CREATE TABLE cms_session_sites (session_id TEXT NOT NULL, site_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, site_id))' },
        { rql: 'CREATE INDEX cms_session_sites_user ON cms_session_sites (user_id)' },
        // Which sites each account is a member of, so the network lists them without opening every site's database.
        { rql: 'CREATE TABLE cms_memberships (account_id TEXT NOT NULL, site_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, site_id))' },
        { rql: 'CREATE INDEX cms_memberships_site ON cms_memberships (site_id)' },
        // Network settings and state by key, as JSON.
        { rql: 'CREATE TABLE cms_network (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)' },
    ],
}, {
    version: 5,
    description: 'Co-editing, notes, plugin schedules, automations, crawler visits and missing pages',
    statements: [
        // One row per entry: the room's values and rich text versions between saves, and who is editing.
        { rql: `CREATE TABLE cms_drafts (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, base_rev INTEGER NOT NULL, data TEXT NOT NULL,
            logs TEXT NOT NULL, editors TEXT NOT NULL, editors_at INTEGER NOT NULL, at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_drafts_editing ON cms_drafts (resource, editors_at)' },
        { rql: 'CREATE INDEX cms_drafts_at ON cms_drafts (at)' },
        // A thread is a root (parent_id NULL, carrying the status and the last activity) and its replies; the anchor is `target`, a passage adds its range and quote.
        { rql: `CREATE TABLE cms_notes (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, parent_id TEXT, user_id TEXT NOT NULL, target TEXT NOT NULL,
            text_range TEXT, quoted TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved')), resolved_by TEXT, resolved_at INTEGER,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        { rql: 'CREATE INDEX cms_notes_entry ON cms_notes (resource, record_id, status)' },
        { rql: 'CREATE INDEX cms_notes_user ON cms_notes (user_id, created_at)' },
        // Who a note mentions (or replies to), and when they opened the entry: "notes for you" and its count.
        { rql: 'CREATE TABLE cms_note_mentions (note_id TEXT NOT NULL, thread_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER, PRIMARY KEY (note_id, user_id))' },
        { rql: 'CREATE INDEX cms_note_mentions_user ON cms_note_mentions (user_id, seen_at)' },
        { rql: 'CREATE INDEX cms_note_mentions_thread ON cms_note_mentions (thread_id)' },
        // One row per declared schedule of a hosted plugin: the next occurrence, claimed by a conditional update when due.
        { rql: 'CREATE TABLE cms_schedules (id TEXT PRIMARY KEY, plugin TEXT NOT NULL, name TEXT NOT NULL, cron TEXT NOT NULL, next_at INTEGER NOT NULL, last_at INTEGER, updated_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_schedules_due ON cms_schedules (next_at)' },
        // When an event happens, send an email.
        { rql: `CREATE TABLE cms_automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, event TEXT NOT NULL, conditions TEXT NOT NULL, action TEXT NOT NULL, active INTEGER NOT NULL,
            runs INTEGER NOT NULL, last_run_at INTEGER, last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        // One row per day, crawler and page kind; only known crawlers are counted.
        { rql: 'CREATE TABLE cms_crawler_visits (day TEXT NOT NULL, agent TEXT NOT NULL, grp TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, agent, kind))' },
        // Paths that answered 404, for Tools → Health and redirects.
        { rql: "CREATE TABLE cms_not_found (path TEXT PRIMARY KEY, hits INTEGER NOT NULL, first_at INTEGER NOT NULL, last_hit_at INTEGER NOT NULL, referrer TEXT NOT NULL DEFAULT '')" },
        { rql: 'CREATE INDEX cms_not_found_hits ON cms_not_found (hits, last_hit_at)' },
    ],
}, {
    version: 6,
    description: 'Registrations waiting for approval',
    statements: [
        // A registered member the site's administrators have not approved yet: their account is disabled until then. `verified` once their email link was opened (1 when the site asks for no confirmation).
        { rql: 'CREATE TABLE cms_registrations (user_id TEXT PRIMARY KEY, verified INTEGER NOT NULL, created_at INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_registrations_created ON cms_registrations (created_at)' },
    ],
}, {
    version: 7,
    description: 'The site search index',
    statements: [
        // One document per entry visitors may read (site-search.ts): collection, entry, locale, title, text and publication time.
        { rql: 'CREATE TABLE cms_search' },
        { rql: 'CREATE SEARCH INDEX cms_search__text ON cms_search(title, text) USING FULLTEXT' },
        // Fill it from the entries a site already has, from the outbox, a round at a time.
        { rql: `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ('search:host-7:0', 'search.rebuild',
            '{"eventId":"search:host-7:0","topic":"search.rebuild","at":0,"run":"host-7","only":null,"collection":null,"after":null,"step":0}', 0, 0, 0, 0)` },
    ],
}, {
    version: 8,
    description: 'Title matches first in the site search',
    statements: [
        // Weights are part of an index's definition (RomeDB 0.2.21), so the index is made again. It is
        // made on an empty table, which is instant, and refilled from the outbox like step 7, so no
        // request builds an index over every row. A rebuild still waiting is replaced by this one.
        { rql: 'DROP INDEX cms_search__text' },
        { rql: 'DELETE FROM cms_search' },
        { rql: `CREATE SEARCH INDEX cms_search__text ON cms_search(title, text) USING FULLTEXT WITH (weights='title=3')` },
        { rql: `DELETE FROM cms_outbox WHERE topic = 'search.rebuild' AND delivered_at IS NULL` },
        { rql: `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ('search:host-8:0', 'search.rebuild',
            '{"eventId":"search:host-8:0","topic":"search.rebuild","at":0,"run":"host-8","only":null,"collection":null,"after":null,"step":0}', 0, 0, 0, 0)` },
    ],
}, {
    version: 9,
    description: 'Security counters counted in the database',
    statements: [
        // Sign-in failures and request budgets (security.ts) by key: each attempt is one conditional increment, so concurrent attempts cannot overwrite each other's count.
        { rql: 'CREATE TABLE cms_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)' },
        { rql: 'CREATE INDEX cms_attempts_until ON cms_attempts (until)' },
    ],
}, {
    version: 10,
    description: 'Automations run as their author',
    statements: [
        // The user who saved or switched on an automation: it runs with their permissions, so it sends only what they may read.
        { rql: 'ALTER TABLE cms_automations ADD COLUMN author TEXT' },
    ],
}, {
    version: 11,
    description: 'Schema changes take the next generation',
    statements: [
        // Every migration batch inserts the next generation, so two that planned from the same schema collide here and one replans; writes to other rows do not hold migrations up.
        { rql: 'CREATE TABLE cms_schema_generations (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)' },
    ],
}, {
    version: 12,
    description: 'Sessions record a second factor used at sign-in',
    statements: [
        // 1 when the sign-in that made the session used an authenticator code, a recovery code or a passkey: required two-step sign-in asks it of the session, not only of the account.
        { rql: 'ALTER TABLE cms_auth_sessions ADD COLUMN second_factor INTEGER' },
    ],
}, {
    version: 13,
    description: 'Accounts record a hold for approval',
    statements: [
        // 1 for an account created waiting for a site's approval: it is not an unconfirmed registration, so another registration of its email never replaces it.
        { rql: 'ALTER TABLE cms_accounts ADD COLUMN held INTEGER' },
    ],
}];

/**
 * The ledger's host steps this build does not have: a database made by another build of the
 * CMS, which this one cannot read safely. Empty for this build's own databases.
 */
export function unknownHostSteps(applied: Iterable<number>): number[] {
    const known = new Set(HOST_STEPS.map(step => step.version));
    return [...applied].filter(version => !known.has(version)).sort((a, b) => a - b);
}

/** The error a database of another build gets, naming its steps and this build's. */
export function hostSchemaMismatch(unknown: readonly number[]): string {
    return `This database was made by another build of the CMS: its schema has host steps ${unknown.join(', ')}, which this build does not have (it has 1 to ${HOST_STEPS.length}). Start a new database, or run the build that made it.`;
}
