/**
 * Menus: one `cms_menus` row per menu, its items as a JSON tree with a revision. Saving is
 * one conditional UPDATE on the revision, so a stale editor writes nothing. Locations map
 * to menus in `cms_menu_locations`. Resolved menus are cached per isolate and dropped on
 * every write made here.
 */
import { ClientError, type FastDB, type Statement } from '@cossackframework/fastdb';
import { CmsError } from '../errors';
import { MENU_LIMITS, MENU_LOCATION, menuProblems, menuSize, normalizeMenu, type MenuItem, type MenuItemView, type MenuShape } from '../menus';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';

export interface MenuSummary {
    readonly id: string;
    readonly name: string;
    readonly items: number;
    readonly locations: readonly string[];
    readonly updatedAt: number;
}

export interface CmsMenusOptions {
    /** Items with entries and terms resolved for visitors; items whose target is gone are left out. */
    readonly resolve: (items: readonly MenuItem[], locale?: string) => Promise<MenuItemView[]>;
    readonly now?: () => number;
    readonly ttlMs?: number;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const WRITE = { kind: 'cms.menus' } as const;
const COLUMNS = 'id, name, items, revision, created_at, updated_at';

export class CmsMenus {
    readonly #db: FastDB;
    readonly #resolve: CmsMenusOptions['resolve'];
    readonly #now: () => number;
    readonly #ttl: number;
    #cache = new Map<string, { at: number; value: Promise<MenuItemView[] | null> }>();

    constructor(db: FastDB, options: CmsMenusOptions) {
        this.#db = db;
        this.#resolve = options.resolve;
        this.#now = options.now ?? Date.now;
        this.#ttl = options.ttlMs ?? 30_000;
    }

    async list(): Promise<MenuSummary[]> {
        const result = await this.#db.read([
            { sql: `SELECT ${COLUMNS} FROM cms_menus ORDER BY lower(name), id LIMIT 200` },
            { sql: 'SELECT location, menu_id FROM cms_menu_locations ORDER BY location LIMIT 200' },
        ]);
        const locations = new Map<string, string[]>();
        for (const [location, menu] of result.results[1]!.rows) locations.set(menu as string, [...(locations.get(menu as string) ?? []), location as string]);
        return result.results[0]!.rows.map(row => {
            const menu = menuOf(row);
            return { id: menu.id, name: menu.name, items: menuSize(menu.items), locations: locations.get(menu.id) ?? [], updatedAt: menu.updatedAt };
        });
    }

    async get(id: string): Promise<MenuShape | null> {
        if (typeof id !== 'string' || !ID.test(id)) return null;
        const result = await this.#db.read([{ sql: `SELECT ${COLUMNS} FROM cms_menus WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? menuOf(row) : null;
    }

    async create(input: { name: string; items?: readonly MenuItem[] }, context: { principal: Principal }): Promise<MenuShape> {
        authorize(context.principal);
        const name = checkName(input.name);
        const items = checkItems(input.items ?? []);
        const id = crypto.randomUUID();
        const now = this.#now();
        await this.#write([{ sql: `INSERT INTO cms_menus (${COLUMNS}, updated_by) VALUES ($id, $name, $items, 1, $now, $now, $by)`,
            params: { $id: id, $name: name, $items: JSON.stringify(items), $now: now, $by: principalId(context.principal) } }]);
        return (await this.get(id))!;
    }

    /** Rename the menu or replace its items. A revision other than the stored one changes nothing and is a conflict. */
    async update(id: string, input: { name?: string; items?: readonly MenuItem[] }, context: { principal: Principal; expectedRevision: number }): Promise<MenuShape> {
        authorize(context.principal);
        const current = await this.get(id);
        if (!current) throw new CmsError('CMS_NOT_FOUND', 'Menu not found.');
        const name = input.name === undefined ? current.name : checkName(input.name);
        const items = input.items === undefined ? current.items : checkItems(input.items);
        const result = await this.#write([{
            sql: 'UPDATE cms_menus SET name = $name, items = $items, revision = revision + 1, updated_at = $now, updated_by = $by WHERE id = $id AND revision = $revision',
            params: { $name: name, $items: JSON.stringify(items), $now: this.#now(), $by: principalId(context.principal), $id: id, $revision: context.expectedRevision },
        }]);
        if (result.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'This menu changed since you opened it. Reload it and try again.');
        return (await this.get(id))!;
    }

    /** Delete a menu and its location assignments. */
    async delete(id: string, context: { principal: Principal }): Promise<void> {
        authorize(context.principal);
        const result = await this.#write([
            { sql: 'DELETE FROM cms_menu_locations WHERE menu_id = $id', params: { $id: id } },
            { sql: 'DELETE FROM cms_menus WHERE id = $id', params: { $id: id } },
        ]);
        if (result.results[1]!.affected !== 1n) throw new CmsError('CMS_NOT_FOUND', 'Menu not found.');
    }

    /** Assigned menus by location. */
    async locations(): Promise<Map<string, string>> {
        const result = await this.#db.read([{ sql: 'SELECT location, menu_id FROM cms_menu_locations ORDER BY location LIMIT 200' }]);
        return new Map(result.results[0]!.rows.map(([location, menu]) => [location as string, menu as string]));
    }

    /** Show the menu in exactly these locations: they move to it, and others it held are cleared. One batch. */
    async place(id: string, locations: readonly string[], context: { principal: Principal; known: readonly string[] }): Promise<void> {
        authorize(context.principal);
        const wanted = [...new Set(locations)];
        for (const location of wanted) if (!MENU_LOCATION.test(location) || !context.known.includes(location)) throw new CmsError('CMS_VALIDATION', `${location} is not a menu location of a theme.`);
        const now = this.#now();
        const statements: Statement[] = [{ sql: `DELETE FROM cms_menu_locations WHERE menu_id = $id${wanted.length ? ` AND location NOT IN (${wanted.map((_, index) => `$l${index}`).join(', ')})` : ''}`,
            params: { $id: id, ...Object.fromEntries(wanted.map((location, index) => [`$l${index}`, location])) } }];
        for (const location of wanted) {
            // Only while the menu exists, so a deleted menu is never placed.
            statements.push({ sql: 'INSERT INTO cms_menu_locations (location, menu_id, updated_at) SELECT $location, $id, $now WHERE EXISTS (SELECT 1 FROM cms_menus WHERE id = $id) ON CONFLICT (location) DO UPDATE SET menu_id = excluded.menu_id, updated_at = excluded.updated_at',
                params: { $location: location, $id: id, $now: now } });
        }
        await this.#write(statements);
    }

    /** Assign one location, or clear it with null. */
    async assign(location: string, id: string | null, context: { principal: Principal; known: readonly string[] }): Promise<void> {
        authorize(context.principal);
        if (!MENU_LOCATION.test(location) || !context.known.includes(location)) throw new CmsError('CMS_VALIDATION', `${location} is not a menu location of a theme.`);
        if (id === null) { await this.#write([{ sql: 'DELETE FROM cms_menu_locations WHERE location = $location', params: { $location: location } }]); return; }
        const result = await this.#write([{ sql: 'INSERT INTO cms_menu_locations (location, menu_id, updated_at) SELECT $location, $id, $now WHERE EXISTS (SELECT 1 FROM cms_menus WHERE id = $id) ON CONFLICT (location) DO UPDATE SET menu_id = excluded.menu_id, updated_at = excluded.updated_at',
            params: { $location: location, $id: id, $now: this.#now() } }]);
        if (result.results[0]!.affected !== 1n) throw new CmsError('CMS_NOT_FOUND', 'Menu not found.');
    }

    /**
     * The resolved menu at a location, or null when none is assigned. With a language, entry
     * items link to their translations in it. Cached.
     */
    forLocation(location: string, locale?: string): Promise<MenuItemView[] | null> {
        const now = this.#now();
        const key = `${location}\n${locale ?? ''}`;
        const cached = this.#cache.get(key);
        if (cached && now - cached.at <= this.#ttl) return cached.value;
        const value = this.#read(location, locale);
        this.#cache.set(key, { at: now, value });
        value.catch(() => this.#cache.delete(key));
        return value;
    }

    /** Resolve items for visitors, for previews. */
    resolve(items: readonly MenuItem[]): Promise<MenuItemView[]> {
        return this.#resolve(items);
    }

    /** Forget resolved menus, for example after content they link to changed. */
    refresh(): void { this.#cache.clear(); }

    async #read(location: string, locale?: string): Promise<MenuItemView[] | null> {
        let row;
        try {
            const result = await this.#db.read([{ sql: `SELECT m.items FROM cms_menu_locations l JOIN cms_menus m ON m.id = l.menu_id WHERE l.location = $location`, params: { $location: location } }]);
            row = result.results[0]!.rows[0];
        } catch (error) {
            // Before setup the tables do not exist.
            if (error instanceof ClientError && /cms_menu|no such table|not found/i.test(error.message)) return null;
            throw error;
        }
        if (!row) return null;
        return this.#resolve(parseItems(row[0] as string), locale);
    }

    async #write(statements: Statement[]) {
        try {
            return await this.#db.write(statements, WRITE);
        } catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'Another menu has this name.', { fields: { name: 'is taken.' } });
            throw error;
        } finally {
            this.#cache.clear();
        }
    }
}

function authorize(principal: Principal): void {
    if (!hasPermission(principal, PERMISSIONS.manageAppearance)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to manage menus.');
}

function checkName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MENU_LIMITS.name) throw new CmsError('CMS_VALIDATION', `Menu names are 1-${MENU_LIMITS.name} characters.`, { fields: { name: 'is required.' } });
    return name.trim();
}

function checkItems(items: readonly MenuItem[]): MenuItem[] {
    const problems = menuProblems(items);
    if (problems.length) throw new CmsError('CMS_VALIDATION', problems.slice(0, 3).join(' '), { fields: { items: problems[0]! } });
    return normalizeMenu(items);
}

function parseItems(value: string): MenuItem[] {
    try {
        const items = JSON.parse(value) as MenuItem[];
        return menuProblems(items).length ? [] : items;
    } catch { return []; }
}

function menuOf(row: readonly unknown[]): MenuShape {
    return Object.freeze({
        id: row[0] as string, name: row[1] as string, items: Object.freeze(parseItems(row[2] as string)), revision: Number(row[3] as bigint),
        createdAt: Number(row[4] as bigint), updatedAt: Number(row[5] as bigint),
    });
}
