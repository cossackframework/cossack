/**
 * Widget areas: one `cms_areas` row per area, its blocks as JSON with a revision. Themes name
 * the areas they render (`theme.areas`); an area keeps its blocks across theme switches, as a
 * menu location keeps its menu. Saving is one conditional write on the revision, so a stale
 * editor writes nothing. Blocks are checked like a blocks field before they are stored.
 */
import { ClientError, type FastDB, type Statement } from '@cossackframework/fastdb';
import type { Block } from '../blocks';
import { CmsError } from '../errors';
import { MENU_LOCATION } from '../menus';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';

export interface AreaShape {
    readonly name: string;
    readonly blocks: readonly Block[];
    /** 0 before the area is first saved. */
    readonly revision: number;
    readonly updatedAt: number;
}

export interface CmsAreasOptions {
    /** Validate blocks as a blocks field would, returning them normalized. */
    readonly check: (blocks: unknown) => Promise<Block[]>;
    readonly now?: () => number;
    readonly ttlMs?: number;
}

const WRITE = { kind: 'cms.areas' } as const;

export class CmsAreas {
    readonly #db: FastDB;
    readonly #check: CmsAreasOptions['check'];
    readonly #now: () => number;
    readonly #ttl: number;
    #cache: { at: number; value: Promise<Map<string, AreaShape>> } | undefined;

    constructor(db: FastDB, options: CmsAreasOptions) {
        this.#db = db;
        this.#check = options.check;
        this.#now = options.now ?? Date.now;
        this.#ttl = options.ttlMs ?? 30_000;
    }

    /** Every saved area by name. Cached per isolate; writes made here drop the cache. */
    all(): Promise<Map<string, AreaShape>> {
        const now = this.#now();
        if (this.#cache && now - this.#cache.at <= this.#ttl) return this.#cache.value;
        const value = this.#read();
        this.#cache = { at: now, value };
        value.catch(() => { this.#cache = undefined; });
        return value;
    }

    /** One area; empty with revision 0 before its first save. */
    async get(name: string): Promise<AreaShape> {
        return (await this.all()).get(name) ?? Object.freeze({ name, blocks: Object.freeze([]), revision: 0, updatedAt: 0 });
    }

    /** Replace an area's blocks. Revision 0 creates it; another revision than the stored one is a conflict. */
    async save(name: string, blocks: unknown, context: { principal: Principal; expectedRevision: number; known: readonly string[] }): Promise<AreaShape> {
        if (!hasPermission(context.principal, PERMISSIONS.manageAppearance)) throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to manage widgets.');
        if (typeof name !== 'string' || !MENU_LOCATION.test(name) || !context.known.includes(name)) throw new CmsError('CMS_VALIDATION', `${String(name)} is not a widget area of a theme.`);
        const checked = await this.#check(blocks);
        const params = { $name: name, $blocks: JSON.stringify(checked), $now: this.#now(), $by: principalId(context.principal) };
        const statement: Statement = context.expectedRevision === 0
            ? { sql: 'INSERT INTO cms_areas (name, blocks, revision, updated_at, updated_by) VALUES ($name, $blocks, 1, $now, $by) ON CONFLICT (name) DO NOTHING', params }
            : { sql: 'UPDATE cms_areas SET blocks = $blocks, revision = revision + 1, updated_at = $now, updated_by = $by WHERE name = $name AND revision = $revision', params: { ...params, $revision: context.expectedRevision } };
        try {
            const result = await this.#db.write([statement], WRITE);
            if (result.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'These widgets changed since you opened them. Reload and try again.');
        } finally {
            this.#cache = undefined;
        }
        return this.get(name);
    }

    async #read(): Promise<Map<string, AreaShape>> {
        let rows: readonly (readonly unknown[])[] = [];
        try {
            rows = (await this.#db.read([{ sql: 'SELECT name, blocks, revision, updated_at FROM cms_areas ORDER BY name LIMIT 200' }])).results[0]!.rows;
        } catch (error) {
            // Before setup, or before the host step that adds the table.
            if (error instanceof ClientError && /cms_areas|no such table|not found/i.test(error.message)) return new Map();
            throw error;
        }
        return new Map(rows.map(([name, blocks, revision, updatedAt]) => [name as string, Object.freeze({
            name: name as string, blocks: Object.freeze(parseBlocks(blocks as string)), revision: Number(revision as bigint), updatedAt: Number(updatedAt as bigint),
        })]));
    }
}

function parseBlocks(value: string): Block[] {
    try {
        const blocks = JSON.parse(value) as unknown;
        return Array.isArray(blocks) ? blocks as Block[] : [];
    } catch { return []; }
}
