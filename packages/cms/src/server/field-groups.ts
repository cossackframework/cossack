/**
 * Field groups: one `cms_field_groups` row per group, its definition as JSON. The host
 * validates a group against the block types and its targets' own fields, merges its fields
 * into the targets' resources and plans the schema; this store keeps the rows and a per-isolate
 * cache the host drops on every write.
 */
import { ClientError, type RomeDB } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { groupsForTarget, upgradeFieldBlocks, type FieldGroup, type FieldGroupTarget } from '../field-groups';
import { principalId, type Principal } from '../permissions';

const WRITE = { kind: 'cms.fieldGroups', retryConflicts: 5 } as const;
const LIMIT = 200;

export class CmsFieldGroups {
    readonly #db: RomeDB;
    readonly #now: () => number;
    #cache: Promise<FieldGroup[]> | undefined;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** Every group, in order then by title. Cached per isolate until a write made here. */
    all(): Promise<FieldGroup[]> {
        this.#cache ??= this.#read().then(groups => groups, error => { this.#cache = undefined; throw error; });
        return this.#cache;
    }

    async get(id: string): Promise<FieldGroup | null> {
        return (await this.all()).find(group => group.id === id) ?? null;
    }

    /** The groups attached to a target, in their order there. */
    async forTarget(target: FieldGroupTarget): Promise<FieldGroup[]> {
        return groupsForTarget(await this.all(), target);
    }

    /** Insert or replace a group the host has checked. */
    async put(group: FieldGroup, principal: Principal): Promise<void> {
        try {
            await this.#db.write([{
                rql: 'INSERT INTO cms_field_groups (id, definition, sort, updated_at, updated_by) VALUES ($id, $definition, $sort, $now, $by) ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, sort = excluded.sort, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
                params: { $id: group.id, $definition: JSON.stringify(group), $sort: group.order ?? 0, $now: this.#now(), $by: principalId(principal) },
            }], WRITE);
        } finally {
            this.#cache = undefined;
        }
    }

    async remove(id: string): Promise<boolean> {
        try {
            const result = await this.#db.write([{ rql: 'DELETE FROM cms_field_groups WHERE id = $id', params: { $id: id } }], WRITE);
            return result.results[0]!.affected === 1n;
        } finally {
            this.#cache = undefined;
        }
    }

    /** Forget the cache, after a write made elsewhere. */
    reset(): void {
        this.#cache = undefined;
    }

    async #read(): Promise<FieldGroup[]> {
        let rows: readonly (readonly unknown[])[] = [];
        try {
            rows = (await this.#db.read([{ rql: `SELECT definition FROM cms_field_groups ORDER BY sort, id LIMIT ${LIMIT}` }])).results[0]!.rows;
        } catch (error) {
            // Before setup the table does not exist; there are no groups.
            if (!(error instanceof ClientError) || !/cms_field_groups|no such table|not found/i.test(error.message)) throw new CmsError('CMS_UNAVAILABLE', 'Field groups could not be read.', { cause: error });
        }
        return rows.flatMap(([definition]) => {
            try {
                const group = JSON.parse(definition as string) as FieldGroup;
                return [Object.freeze({ ...group, blocks: upgradeFieldBlocks(group.blocks ?? []) })];
            } catch { return []; }
        });
    }
}
