/**
 * The one-time rewrite of stored block trees from `id` to `_id`: every blocks and rich text
 * field of every resource, widget areas, field group layouts, collection templates, autosaves
 * and revisions. Runs once, when host step 12 applies, from Tools → Schema, setup or the automatic upgrade.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import type { Resource } from '../resource';

const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BLOCK_TYPE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const WRITE = { kind: 'cms.migration', retryConflicts: 5 } as const;
const PAGE = 100;

/**
 * A value with every block (`{ id, type, data }` with a block type) and every rich text
 * `cmsBlock` node renamed to `_id`, recursively; unchanged values come back as is.
 */
export function renameBlockIds(value: unknown): { value: unknown; changed: boolean } {
    let changed = false;
    const visit = (entry: unknown): unknown => {
        if (Array.isArray(entry)) {
            const items = entry.map(visit);
            return items.some((item, index) => item !== entry[index]) ? items : entry;
        }
        if (!entry || typeof entry !== 'object') return entry;
        const object = entry as Record<string, unknown>;
        let next: Record<string, unknown> | null = null;
        const isBlock = typeof object.id === 'string' && BLOCK_ID.test(object.id) && object._id === undefined && typeof object.type === 'string' && BLOCK_TYPE.test(object.type) && !!object.data && typeof object.data === 'object';
        const isNode = object.type === 'cmsBlock' && !!object.attrs && typeof object.attrs === 'object' && typeof (object.attrs as Record<string, unknown>).id === 'string' && (object.attrs as Record<string, unknown>)._id === undefined;
        if (isBlock) {
            const { id, ...rest } = object;
            next = { _id: id, ...rest };
        }
        if (isNode) {
            const { id, ...attrs } = (next ?? object).attrs as Record<string, unknown>;
            next = { ...(next ?? object), attrs: { _id: id, ...attrs } };
        }
        for (const [key, child] of Object.entries(next ?? object)) {
            const visited = visit(child);
            if (visited !== child) next = { ...(next ?? object), [key]: visited };
        }
        if (next) changed = true;
        return next ?? entry;
    };
    return { value: visit(value), changed };
}

/** JSON text with its block trees renamed, or null when nothing changed or it is not JSON. */
function renameJson(text: unknown): string | null {
    if (typeof text !== 'string' || !text) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return null; }
    const { value, changed } = renameBlockIds(parsed);
    return changed ? JSON.stringify(value) : null;
}

/** Rewrite one table's JSON text column, row by row, keyed by `key`. */
async function rewriteJsonColumn(db: RomeDB, table: string, key: string, column: string): Promise<number> {
    let changed = 0;
    for (let offset = 0; ; offset += PAGE) {
        const page = await db.read([{ rql: `SELECT ${key}, ${column} FROM ${table} ORDER BY ${key} LIMIT ${PAGE} OFFSET ${offset}` }]);
        const rows = page.results[0]!.rows;
        const statements: Statement[] = [];
        for (const [id, text] of rows) {
            const next = renameJson(text);
            if (next !== null) statements.push({ rql: `UPDATE ${table} SET ${column} = $value WHERE ${key} = $id`, params: { $value: next, $id: id as Value } });
        }
        if (statements.length) { await db.write(statements, WRITE); changed += statements.length; }
        if (rows.length < PAGE) return changed;
    }
}

/** Rewrite the blocks and rich text fields of a resource's records, without touching their revision. */
async function rewriteResource(db: RomeDB, resource: Resource): Promise<number> {
    const fields = Object.entries(resource.fields).filter(([, declaration]) => declaration.kind === 'blocks' || declaration.kind === 'richtext').map(([name]) => name);
    if (!fields.length) return 0;
    const columns = fields.map(name => `"${name}"`).join(', ');
    let changed = 0;
    for (let offset = 0; ; offset += PAGE) {
        const page = await db.read([{ rql: `SELECT id, ${columns} FROM ${resource.storage} ORDER BY record::id(id) LIMIT ${PAGE} OFFSET ${offset}` }]);
        const rows = page.results[0]!.rows;
        const statements: Statement[] = [];
        for (const row of rows) {
            const key = (row[0] as { key: unknown }).key;
            const sets: string[] = [];
            const params: { [name: string]: Value } = { $key: key as Value };
            fields.forEach((name, index) => {
                const { value, changed: did } = renameBlockIds(row[index + 1]);
                if (did) { sets.push(`"${name}" = $f${index}`); params[`$f${index}`] = value as Value; }
            });
            if (sets.length) statements.push({ rql: `UPDATE ${resource.storage} SET ${sets.join(', ')} WHERE id = type::record('${resource.storage}', $key)`, params });
        }
        if (statements.length) { await db.write(statements, WRITE); changed += statements.length; }
        if (rows.length < PAGE) return changed;
    }
}

/**
 * Rename block IDs in stored definitions and copies: collection templates, field groups, widget
 * areas, autosaves and revisions. Runs before the records, because a collection whose stored
 * template still has `id` fails validation and is not among the host's resources until it is rewritten.
 */
export async function renameStoredDefinitions(db: RomeDB): Promise<number> {
    let changed = 0;
    changed += await rewriteJsonColumn(db, 'cms_collections', 'name', 'definition');
    changed += await rewriteJsonColumn(db, 'cms_field_groups', 'id', 'definition');
    changed += await rewriteJsonColumn(db, 'cms_areas', 'name', 'blocks');
    changed += await rewriteJsonColumn(db, 'cms_autosaves', 'id', 'data');
    changed += await rewriteJsonColumn(db, 'cms_revisions', 'id', 'data');
    return changed;
}

/** Rename block IDs in the blocks and rich text fields of these resources' records. */
export async function renameStoredRecords(db: RomeDB, resources: readonly Resource[]): Promise<number> {
    let changed = 0;
    for (const resource of resources) changed += await rewriteResource(db, resource);
    return changed;
}

/** Rename block IDs everywhere they are stored. Returns how many rows changed. Safe to run again: renamed trees are left alone. */
export async function renameStoredBlockIds(db: RomeDB, resources: readonly Resource[]): Promise<number> {
    return await renameStoredDefinitions(db) + await renameStoredRecords(db, resources);
}
