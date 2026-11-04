/** Settings declarations, authorized portable documents, and atomic storage. */
import { ClientError, UncertainWriteError, encodeValue, type RomeDB, type Statement } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { FIELD_NAME } from '../fields';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';
import { OWNER_NAME } from '../resource';
import type { SettingsGroup, SiteSettings } from '../settings';
import { settingControlProblems, validateSettingValue } from '../settings-controls';
import { checkSettingsDocument, isPortableSetting, SETTINGS_DOCUMENT_MAX_FIELDS, stringifySettingsDocument, type SettingsDocument, type SettingsValue } from '../settings-document';

const WRITE = { kind: 'cms.settings', retryConflicts: 5, workLimits: { rowsRead: 100_000, rowMutations: 5000, vmSteps: 2_000_000 } } as const;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const EXCLUDED = new Set(['appearance', 'languages', 'permalinks']);
const encoder = new TextEncoder();
type Context = { principal: Principal };
type Stored = { values: SiteSettings; errors: Record<string, string> };

export class CmsSettings {
    readonly #db: RomeDB;
    readonly #groups = new Map<string, SettingsGroup>();
    readonly #now: () => number;
    readonly #ttl: number;
    #cache: { at: number; values: Promise<Stored> } | undefined;

    constructor(db: RomeDB, groups: readonly SettingsGroup[], options: { now?: () => number; ttlMs?: number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
        this.#ttl = options.ttlMs ?? 30_000;
        for (const group of groups) {
            const plugin = group.plugin;
            const valid = plugin !== undefined
                ? OWNER_NAME.test(plugin) && plugin.length <= 64 && group.id === `plugin:${plugin}`
                : /^[a-z][a-z0-9-]{0,40}$/.test(group.id) && !['plugins', 'json'].includes(group.id);
            if (!valid || UNSAFE.has(group.id) || this.#groups.has(group.id)) throw new Error(`Settings group ${group.id} is invalid or declared twice.`);
            for (const name of Object.keys(group.fields)) {
                if (!FIELD_NAME.test(name) || UNSAFE.has(name)) throw new Error(`Settings field ${group.id}.${name} has an invalid name.`);
                const problems = settingControlProblems(name, group.fields[name]!);
                if (problems.length) throw new Error(`Settings group ${group.id}: ${problems.join(' ')}`);
            }
            this.#groups.set(group.id, group);
        }
    }

    get groups(): readonly SettingsGroup[] { return [...this.#groups.values()]; }

    group(id: string): SettingsGroup {
        const group = this.#groups.get(id);
        if (!group) throw new CmsError('CMS_NOT_FOUND', `Unknown settings group ${id}.`);
        return group;
    }

    /** Internal server reads, with defaults. Never expose this method directly through browser RPC. */
    async all(): Promise<SiteSettings> {
        const now = this.#now();
        if (!this.#cache || now - this.#cache.at > this.#ttl) {
            const values = this.#read();
            this.#cache = { at: now, values };
            values.catch(() => { if (this.#cache?.values === values) this.#cache = undefined; });
        }
        return (await this.#cache.values).values;
    }

    async get<K extends keyof SiteSettings & string>(key: K): Promise<SiteSettings[K]> {
        return (await this.all())[key];
    }

    /** Only opted-in scalar groups the principal can edit. Declarations are detached before exposure. */
    catalog({ principal }: Context): readonly SettingsGroup[] {
        return this.groups.filter(group => this.#portable(group) && hasPermission(principal, group.permission ?? PERMISSIONS.manageSettings))
            .map(group => structuredClone(group));
    }

    /** Fresh authorized values. Invalid stored overrides are reported rather than silently exported as defaults. */
    async snapshot(context: Context): Promise<SettingsDocument> {
        return this.#document(await this.#read(), this.catalog(context));
    }

    async exportDocument(context: Context): Promise<string> {
        return stringifySettingsDocument(await this.snapshot(context));
    }

    /** Validate the complete patch and its encoded write size before any mutation. */
    validateDocument(input: unknown, context: Context): SettingsDocument {
        const document = checkSettingsDocument(input);
        const errors: Record<string, string> = {};
        for (const [id, fields] of Object.entries(document)) {
            const group = this.#groups.get(id);
            if (!group || !this.#portable(group)) {
                errors[id] = 'is not available in settings JSON.';
                continue;
            }
            this.#authorize(group, context);
            for (const [name, value] of Object.entries(fields)) {
                const declaration = Object.hasOwn(group.fields, name) ? group.fields[name] : undefined;
                const error = declaration ? validateSettingValue(name, declaration, value) : 'is not a setting of this group.';
                if (error) errors[`${id}.${name}`] = error;
            }
        }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some settings are invalid.', { fields: errors });
        this.#statement(Object.entries(document).flatMap(([id, fields]) => Object.entries(fields).map(([name, value]) => [`${id}.${name}`, value] as const)), context);
        return document;
    }

    async applyDocument(input: unknown, context: Context): Promise<SettingsDocument> {
        const document = this.validateDocument(input, context);
        const stored = await this.#read();
        const values = { ...stored.values };
        const errors = { ...stored.errors };
        const entries: (readonly [string, unknown])[] = [];
        for (const [id, fields] of Object.entries(document)) for (const [name, value] of Object.entries(fields)) {
            const key = `${id}.${name}`;
            // Equal values are still explicit overrides: an imported default must remain pinned.
            entries.push([key, value]);
            values[key] = value;
            delete errors[key];
        }
        // Do not commit and then report a validation failure from another invalid stored field.
        const result = this.#document({ values: values as SiteSettings, errors }, this.catalog(context));
        await this.#write(entries, context);
        return result;
    }

    /** Validate and store part of one group. Dedicated groups retain their existing domain operations. */
    async update(groupId: string, input: { readonly [field: string]: unknown }, context: Context): Promise<SiteSettings> {
        const group = this.group(groupId);
        this.#authorize(group, context);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CmsError('CMS_VALIDATION', 'Settings values must be an object.');
        const errors: Record<string, string> = {};
        const entries: (readonly [string, unknown])[] = [];
        for (const [name, value] of Object.entries(input)) {
            const declaration = Object.hasOwn(group.fields, name) ? group.fields[name] : undefined;
            if (!declaration) { errors[name] = 'is not a setting of this group.'; continue; }
            if (value === undefined) continue;
            const error = validateSettingValue(name, declaration, value);
            if (error) { errors[name] = error; continue; }
            entries.push([`${group.id}.${name}`, value]);
        }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some settings are invalid.', { fields: errors });
        await this.#write(entries, context);
        return this.all();
    }

    refresh(): void { this.#cache = undefined; }

    #portable(group: SettingsGroup): boolean {
        return group.json === true && !EXCLUDED.has(group.id) && (group.permission ?? PERMISSIONS.manageSettings) !== PERMISSIONS.manageAppearance
            && Object.values(group.fields).every(isPortableSetting);
    }

    #authorize(group: SettingsGroup, { principal }: Context): void {
        if (!hasPermission(principal, group.permission ?? PERMISSIONS.manageSettings)) {
            throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to change settings.');
        }
    }

    #document(stored: Stored, groups: readonly SettingsGroup[]): SettingsDocument {
        const document: SettingsDocument = {};
        const errors: Record<string, string> = {};
        for (const group of groups) {
            const fields: Record<string, SettingsValue> = {};
            for (const [name, declaration] of Object.entries(group.fields)) {
                const key = `${group.id}.${name}`;
                if (stored.errors[key]) errors[key] = stored.errors[key]!;
                const value = stored.values[key];
                if (value === null && !declaration.nullable && declaration.default === undefined) continue;
                const problem = validateSettingValue(name, declaration, value);
                if (problem) errors[key] = problem;
                else fields[name] = value as SettingsValue;
            }
            document[group.id] = fields;
        }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some saved settings no longer match their declarations. Correct these values before exporting or applying the document.', { fields: errors });
        // A snapshot can exceed the file limit: keep forms usable and let export fail explicitly.
        return document;
    }

    #statement(entries: readonly (readonly [string, unknown])[], context: Context): Statement | undefined {
        if (!entries.length) return;
        if (entries.length > SETTINGS_DOCUMENT_MAX_FIELDS) throw new CmsError('CMS_LIMIT', `A settings save contains at most ${SETTINGS_DOCUMENT_MAX_FIELDS} fields.`);
        const statement: Statement = {
            rql: `INSERT INTO cms_settings (key, value, updated_at, updated_by)
                SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), $now, $by FROM json_each($rows) WHERE true
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
            params: { $rows: JSON.stringify(entries.map(([key, value]) => [key, JSON.stringify(value)])), $now: this.#now(), $by: principalId(context.principal) },
        };
        // The service protocol also encodes bound strings. Leave room for its request identity and work limits.
        const bytes = encoder.encode(JSON.stringify({ sql: statement.rql, params: Object.fromEntries(Object.entries(statement.params!).map(([name, value]) => [name, encodeValue(value)])) })).byteLength;
        if (bytes > 60 * 1024) throw new CmsError('CMS_LIMIT', 'This settings save exceeds the 60 KiB encoded write limit. Apply fewer changes.');
        return statement;
    }

    async #write(entries: readonly (readonly [string, unknown])[], context: Context): Promise<void> {
        const statement = this.#statement(entries, context);
        if (!statement) return;
        try { await this.#db.write([statement], WRITE); }
        catch (error) {
            if (error instanceof UncertainWriteError) {
                this.refresh();
                throw new CmsError('CMS_UNCERTAIN', 'The settings save was sent but not confirmed. Its exact request is saved for recovery. Reload before making another change.', { requestId: error.requestId, cause: error });
            }
            throw error;
        }
        this.refresh();
    }

    async #read(): Promise<Stored> {
        // Retry if another writer commits between pages, so one export cannot mix snapshots.
        for (let attempt = 0; attempt < 3; attempt++) {
            const values: Record<string, unknown> = {};
            const errors: Record<string, string> = {};
            for (const group of this.#groups.values()) for (const [name, declaration] of Object.entries(group.fields)) values[`${group.id}.${name}`] = declaration.default ?? null;
            let after = '';
            let sequence: number | undefined;
            let count = 0;
            let pageSize = 100;
            for (;;) {
                let result;
                try { result = await this.#db.read([{ rql: 'SELECT key, value FROM cms_settings WHERE key > $after ORDER BY key LIMIT $limit', params: { $after: after, $limit: pageSize } }]); }
                catch (error) {
                    if (error instanceof ClientError && /cms_settings/i.test(error.message) && /no such table|not found|does not exist/i.test(error.message)) return { values: Object.freeze(values) as SiteSettings, errors };
                    if (error instanceof ClientError && (error.code === 'RDB_LIMIT' || error.code === 'RDB_RESULT_TOO_LARGE') && pageSize > 1) { pageSize = Math.max(1, Math.floor(pageSize / 2)); continue; }
                    throw error;
                }
                if (sequence !== undefined && sequence !== result.sequence) break;
                sequence = result.sequence;
                const rows = result.results[0]!.rows;
                count += rows.length;
                if (count > 20_000) throw new CmsError('CMS_LIMIT', 'The settings store exceeds the supported 20000-row read limit.');
                for (const [key, raw] of rows) {
                    const full = String(key);
                    const dot = full.indexOf('.');
                    const group = this.#groups.get(full.slice(0, dot));
                    const name = full.slice(dot + 1);
                    const declaration = group && Object.hasOwn(group.fields, name) ? group.fields[name] : undefined;
                    if (!declaration) continue;
                    try {
                        const parsed: unknown = JSON.parse(raw as string);
                        const error = validateSettingValue(name, declaration, parsed);
                        if (error) errors[full] = error;
                        else values[full] = parsed;
                    } catch { errors[full] = 'contains invalid stored JSON.'; }
                }
                if (rows.length < pageSize) return { values: Object.freeze(values) as SiteSettings, errors };
                after = String(rows[rows.length - 1]![0]);
            }
        }
        throw new CmsError('CMS_CONFLICT', 'Settings changed while they were being read. Reload and try again.');
    }
}
