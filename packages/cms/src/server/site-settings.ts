/**
 * Settings storage: one `cms_settings` row per key, validated against the declared groups.
 * Values are cached per isolate or process and the cache is dropped on every write here.
 */
import type { FastDB, Statement } from '@cossackframework/fastdb';
import { CmsError } from '../errors';
import { validateValue } from '../fields';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';
import type { SettingsGroup, SiteSettings } from '../settings';

const WRITE = { kind: 'cms.settings', retryConflicts: 5 } as const;

export class CmsSettings {
    readonly #db: FastDB;
    readonly #groups = new Map<string, SettingsGroup>();
    readonly #now: () => number;
    readonly #ttl: number;
    #cache: { at: number; values: Promise<SiteSettings> } | undefined;

    constructor(db: FastDB, groups: readonly SettingsGroup[], options: { now?: () => number; ttlMs?: number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
        this.#ttl = options.ttlMs ?? 30_000;
        for (const group of groups) {
            if (!/^[a-z][a-z0-9-]{0,40}$/.test(group.id) || this.#groups.has(group.id)) throw new Error(`Settings group ${group.id} is invalid or declared twice.`);
            this.#groups.set(group.id, group);
        }
    }

    get groups(): readonly SettingsGroup[] { return [...this.#groups.values()]; }

    group(id: string): SettingsGroup {
        const group = this.#groups.get(id);
        if (!group) throw new CmsError('CMS_NOT_FOUND', `Unknown settings group ${id}.`);
        return group;
    }

    /** Every declared setting with defaults applied. Before setup, the defaults. */
    all(): Promise<SiteSettings> {
        const now = this.#now();
        if (!this.#cache || now - this.#cache.at > this.#ttl) {
            const values = this.#read();
            this.#cache = { at: now, values };
            values.catch(() => { this.#cache = undefined; });
        }
        return this.#cache.values;
    }

    async get<K extends keyof SiteSettings & string>(key: K): Promise<SiteSettings[K]> {
        return (await this.all())[key];
    }

    /** Validate and store a group's submitted values. Unknown keys are refused. */
    async update(groupId: string, input: { readonly [field: string]: unknown }, context: { principal: Principal }): Promise<SiteSettings> {
        const group = this.group(groupId);
        if (!hasPermission(context.principal, group.permission ?? PERMISSIONS.manageSettings)) throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to change settings.');
        const errors: { [field: string]: string } = {};
        const statements: Statement[] = [];
        const now = this.#now();
        for (const [name, value] of Object.entries(input)) {
            const declaration = group.fields[name];
            if (!declaration) { errors[name] = 'is not a setting of this group.'; continue; }
            const error = value === undefined ? undefined : validateValue(name, declaration, value);
            if (error) { errors[name] = error; continue; }
            if (value === undefined) continue;
            statements.push({
                sql: 'INSERT INTO cms_settings (key, value, updated_at, updated_by) VALUES ($key, $value, $now, $by) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
                params: { $key: `${group.id}.${name}`, $value: JSON.stringify(value), $now: now, $by: principalId(context.principal) },
            });
        }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some settings are invalid.', { fields: errors });
        for (let offset = 0; offset < statements.length; offset += 30) await this.#db.write(statements.slice(offset, offset + 30), WRITE);
        this.#cache = undefined;
        return this.all();
    }

    /** Forget cached values, for example after a change made elsewhere. */
    refresh(): void { this.#cache = undefined; }

    async #read(): Promise<SiteSettings> {
        const values: { [key: string]: unknown } = {};
        for (const group of this.#groups.values()) for (const [name, declaration] of Object.entries(group.fields)) values[`${group.id}.${name}`] = declaration.default ?? null;
        let rows: readonly (readonly unknown[])[] = [];
        try { rows = (await this.#db.read([{ sql: 'SELECT key, value FROM cms_settings ORDER BY key LIMIT 1000' }])).results[0]!.rows; }
        catch (error) {
            // Before setup the table does not exist; the defaults apply.
            if (!/cms_settings|no such table|not found/i.test(String((error as Error).message))) throw error;
        }
        for (const [key, value] of rows) {
            const [groupId, name] = String(key).split('.', 2);
            const declaration = this.#groups.get(groupId!)?.fields[name!];
            if (!declaration) continue;
            try {
                const parsed = JSON.parse(value as string);
                if (validateValue(name!, declaration, parsed) === undefined) values[key as string] = parsed;
            } catch { /* keep the default */ }
        }
        return Object.freeze(values) as SiteSettings;
    }
}
