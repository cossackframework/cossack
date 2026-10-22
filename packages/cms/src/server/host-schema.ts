/**
 * Relational host tables. The host owns the `cms_` and `cossack_` namespaces; plugins
 * never create tables. Each host step is versioned and applies once through the ledger,
 * and fits one batch (32 statements, including the ledger row).
 */
import type { Statement } from '@cossackframework/fastdb';
import { jobStateSchema } from '@cossackframework/core/jobs';
import { notificationStateSchema } from '@cossackframework/core/notifications';

export interface HostStep {
    readonly version: number;
    readonly description: string;
    readonly statements: readonly Statement[];
}

const split = (script: string): Statement[] => script.split(';').map(sql => sql.trim()).filter(Boolean)
    .map(sql => ({ sql: sql.replace(/\bIF NOT EXISTS\s+/g, '') }));

export const HOST_TABLES = [
    'cms_migrations', 'cms_schema_state', 'cms_users', 'cms_roles', 'cms_user_roles', 'cms_auth_sessions', 'cms_oauth_states',
    'cms_password_resets', 'cms_sessions', 'cms_session_values', 'cms_grants', 'cms_audit', 'cms_revisions', 'cms_outbox', 'cms_files',
    'cms_terms', 'cms_settings', 'cms_collections', 'cms_taxonomies', 'cms_field_groups', 'cms_menus', 'cms_menu_locations',
    'cms_preview_tokens', 'cms_autosaves', 'cms_file_variants', 'cms_redirects', 'cms_api_tokens', 'cms_webhooks', 'cms_webhook_deliveries',
    'cms_comments', 'cms_user_security', 'cms_passkeys', 'cms_auth_challenges', 'cms_areas', 'cms_form_sends', 'cms_form_mail', 'cms_form_results',
    'cossack_jobs', 'cossack_notifications',
] as const;

export const HOST_STEPS: readonly HostStep[] = [{
    version: 1,
    description: 'Create CMS host tables',
    statements: [
        { sql: `CREATE TABLE cms_migrations (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('host','additive','explicit')), owner TEXT NOT NULL,
            resource TEXT, version INTEGER NOT NULL, declaration_hash TEXT, sql TEXT NOT NULL, engine_version TEXT NOT NULL, applied_at INTEGER NOT NULL)` },
        { sql: 'CREATE TABLE cms_schema_state (resource TEXT PRIMARY KEY, declaration_hash TEXT NOT NULL, updated_at INTEGER NOT NULL)' },
        { sql: `CREATE TABLE cms_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, avatar TEXT,
            status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_users_created ON cms_users (created_at)' },
        { sql: 'CREATE TABLE cms_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL, created_at INTEGER NOT NULL)' },
        { sql: 'CREATE TABLE cms_user_roles (user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (user_id, role_id))' },
        { sql: 'CREATE INDEX cms_user_roles_role ON cms_user_roles (role_id)' },
        // Keyed by the session token, so rotation is one conditional update of the key.
        { sql: `CREATE TABLE cms_auth_sessions (id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, user_agent TEXT)` },
        { sql: 'CREATE INDEX cms_auth_sessions_user ON cms_auth_sessions (user_id, expires_at)' },
        { sql: 'CREATE TABLE cms_oauth_states (key TEXT PRIMARY KEY, provider TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        // Keyed by the SHA-256 of the emailed token, so a database read cannot reset a password.
        { sql: 'CREATE TABLE cms_password_resets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_password_resets_user ON cms_password_resets (user_id)' },
        { sql: 'CREATE TABLE cms_sessions (id TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_sessions_expiry ON cms_sessions (expires_at)' },
        // One row per key, so concurrent writes to different keys never overwrite each other.
        { sql: 'CREATE TABLE cms_session_values (session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (session_id, key))' },
        { sql: `CREATE TABLE cms_grants (id TEXT PRIMARY KEY, subject TEXT NOT NULL, permission TEXT NOT NULL, revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE (subject, permission))` },
        { sql: `CREATE TABLE cms_audit (id TEXT PRIMARY KEY, actor TEXT, action TEXT NOT NULL, resource TEXT NOT NULL, record_id TEXT NOT NULL,
            revision INTEGER, at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_audit_record ON cms_audit (resource, record_id, at)' },
        { sql: `CREATE TABLE cms_revisions (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
            data TEXT NOT NULL, actor TEXT, at INTEGER NOT NULL, UNIQUE (resource, record_id, revision))` },
        { sql: `CREATE TABLE cms_outbox (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
            available_at INTEGER NOT NULL, attempts INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL,
            delivered_at INTEGER, pending_plugins TEXT)` },
        { sql: 'CREATE INDEX cms_outbox_ready ON cms_outbox (delivered_at, available_at)' },
    ],
}, {
    version: 2,
    description: 'Create CMS media, taxonomy, settings and ledger tables',
    statements: [
        { sql: `CREATE TABLE cms_files (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, owner_id TEXT, name TEXT NOT NULL, content_type TEXT NOT NULL,
            size INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','ready','deleting')), title TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '',
            caption TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', width INTEGER, height INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_files_status ON cms_files (status, updated_at)' },
        { sql: 'CREATE INDEX cms_files_created ON cms_files (status, created_at)' },
        // Materialized path of ancestor IDs, such as /a/b/: a subtree is one prefix match.
        { sql: `CREATE TABLE cms_terms (id TEXT PRIMARY KEY, taxonomy TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            parent_id TEXT, path TEXT NOT NULL, depth INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (taxonomy, slug))` },
        { sql: 'CREATE INDEX cms_terms_path ON cms_terms (taxonomy, path)' },
        { sql: 'CREATE INDEX cms_terms_parent ON cms_terms (parent_id)' },
        { sql: 'CREATE TABLE cms_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        // Collection and taxonomy definitions made in the dashboard; built-ins store only what was added.
        { sql: 'CREATE TABLE cms_collections (name TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        { sql: 'CREATE TABLE cms_taxonomies (name TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        ...split(jobStateSchema),
        ...split(notificationStateSchema),
    ],
}, {
    version: 3,
    description: 'Create CMS menu tables',
    statements: [
        // A menu's items are one JSON tree, saved with a revision check.
        { sql: `CREATE TABLE cms_menus (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, items TEXT NOT NULL, revision INTEGER NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)` },
        { sql: 'CREATE TABLE cms_menu_locations (location TEXT PRIMARY KEY, menu_id TEXT NOT NULL, updated_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_menu_locations_menu ON cms_menu_locations (menu_id)' },
    ],
}, {
    version: 4,
    description: 'Create CMS preview, autosave, redirect, API token and webhook tables',
    statements: [
        // Keyed by the SHA-256 of the shared token, so a database read cannot preview anything.
        { sql: `CREATE TABLE cms_preview_tokens (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, created_by TEXT,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_preview_tokens_record ON cms_preview_tokens (resource, record_id)' },
        // One autosave per user and entry; `new` stands for an entry not saved yet.
        { sql: `CREATE TABLE cms_autosaves (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL,
            at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_autosaves_at ON cms_autosaves (at)' },
        { sql: `CREATE TABLE cms_redirects (id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, target TEXT NOT NULL, status INTEGER NOT NULL CHECK(status IN (301,302,307,308,410)),
            prefix INTEGER NOT NULL CHECK(prefix IN (0,1)), kind TEXT NOT NULL CHECK(kind IN ('auto','manual')), note TEXT NOT NULL DEFAULT '', hits INTEGER NOT NULL DEFAULT 0,
            last_hit_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT)` },
        { sql: 'CREATE INDEX cms_redirects_target ON cms_redirects (target)' },
        { sql: 'CREATE INDEX cms_redirects_prefix ON cms_redirects (prefix, updated_at)' },
        // Application passwords: the secret is stored as its SHA-256.
        { sql: `CREATE TABLE cms_api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('read','write')), created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER)` },
        { sql: 'CREATE INDEX cms_api_tokens_user ON cms_api_tokens (user_id, created_at)' },
        { sql: `CREATE TABLE cms_webhooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, collections TEXT NOT NULL, secret TEXT NOT NULL,
            active INTEGER NOT NULL CHECK(active IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_by TEXT)` },
        // One delivery per webhook and event, leased like outbox rows.
        { sql: `CREATE TABLE cms_webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')), attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, lease_token TEXT,
            lease_until INTEGER NOT NULL, response_status INTEGER, error TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER, UNIQUE (webhook_id, event_id))` },
        { sql: 'CREATE INDEX cms_webhook_deliveries_due ON cms_webhook_deliveries (status, next_attempt_at)' },
        { sql: 'CREATE INDEX cms_webhook_deliveries_hook ON cms_webhook_deliveries (webhook_id, created_at)' },
        // Crop and focal point of an image, as JSON, and the resized variants made of it.
        { sql: 'ALTER TABLE cms_files ADD COLUMN edits TEXT' },
        { sql: 'CREATE TABLE cms_file_variants (key TEXT PRIMARY KEY, file_id TEXT NOT NULL, created_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_file_variants_file ON cms_file_variants (file_id)' },
    ],
}, {
    version: 5,
    description: 'Create CMS comment and sign-in tables',
    statements: [
        { sql: `CREATE TABLE cms_comments (id TEXT PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL, parent_id TEXT, user_id TEXT,
            author_name TEXT NOT NULL, author_email TEXT NOT NULL, author_url TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','approved','spam','trash')), ip_hash TEXT, user_agent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_comments_entry ON cms_comments (resource, record_id, status, created_at)' },
        { sql: 'CREATE INDEX cms_comments_status ON cms_comments (status, created_at)' },
        { sql: 'CREATE INDEX cms_comments_ip ON cms_comments (ip_hash, created_at)' },
        { sql: 'CREATE INDEX cms_comments_author ON cms_comments (author_email, status)' },
        // Second factors: an authenticator app's secret, the last step it used, and recovery code hashes.
        { sql: `CREATE TABLE cms_user_security (user_id TEXT PRIMARY KEY, totp_secret TEXT, totp_confirmed_at INTEGER, totp_last_step INTEGER, recovery TEXT,
            updated_at INTEGER NOT NULL)` },
        { sql: `CREATE TABLE cms_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL,
            transports TEXT, device_type TEXT, backed_up INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER)` },
        { sql: 'CREATE INDEX cms_passkeys_user ON cms_passkeys (user_id)' },
        // Pending sign-ins and WebAuthn challenges, keyed by a random ID kept in a cookie.
        { sql: `CREATE TABLE cms_auth_challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, challenge TEXT NOT NULL, attempts INTEGER NOT NULL,
            expires_at INTEGER NOT NULL)` },
        { sql: 'CREATE INDEX cms_auth_challenges_expiry ON cms_auth_challenges (expires_at)' },
    ],
}, {
    version: 6,
    description: 'Record when users last signed in',
    statements: [
        // Sessions are deleted at sign-out; the user keeps the time of the newest one.
        { sql: 'ALTER TABLE cms_users ADD COLUMN last_sign_in_at INTEGER' },
        { sql: 'UPDATE cms_users SET last_sign_in_at = (SELECT max(s.created_at) FROM cms_auth_sessions s WHERE s.user_id = cms_users.id)' },
    ],
}, {
    version: 7,
    description: 'Add widget areas',
    statements: [
        // A theme's widget area: its blocks as JSON, saved with a revision check.
        { sql: 'CREATE TABLE cms_areas (name TEXT PRIMARY KEY, blocks TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)' },
    ],
}, {
    version: 8,
    description: 'Add form tables',
    statements: [
        // One row per form submission for a day: the write's receipt and the per-address throttle. Submissions live in each form's own table.
        { sql: 'CREATE TABLE cms_form_sends (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, ip_hash TEXT, at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_form_sends_ip ON cms_form_sends (form_id, ip_hash, at)' },
        { sql: 'CREATE INDEX cms_form_sends_at ON cms_form_sends (at)' },
        // Notification emails already sent, by event, rule and recipient, so outbox retries do not send them again.
        { sql: 'CREATE TABLE cms_form_mail (id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_form_mail_sent ON cms_form_mail (sent_at)' },
        // What a form post returns to the page after its redirect: the confirmation, or the errors and values. Read once.
        { sql: 'CREATE TABLE cms_form_results (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL)' },
        { sql: 'CREATE INDEX cms_form_results_expiry ON cms_form_results (expires_at)' },
    ],
}, {
    version: 9,
    description: 'Give terms an icon',
    statements: [
        { sql: "ALTER TABLE cms_terms ADD COLUMN icon TEXT NOT NULL DEFAULT ''" },
    ],
}, {
    version: 10,
    description: 'Field groups, and meta on terms and users',
    statements: [
        { sql: 'CREATE TABLE cms_field_groups (id TEXT PRIMARY KEY, definition TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, updated_by TEXT)' },
        { sql: "ALTER TABLE cms_terms ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'" },
        { sql: "ALTER TABLE cms_users ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'" },
    ],
}];
