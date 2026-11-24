/**
 * How a field's value is kept in a document, and read back: the same for an entry of a
 * collection and for the field values of a user or a term. A reference is a record link, a
 * fractional number an explicit float, and rich text, blocks and rows are nested values.
 */
import { Float64, RecordId, Vector, type RomeDB, type Statement, type Value } from '@cossackframework/romedb';
import { SYSTEM_META } from '../field-groups';
import { readByIds } from './budget';
import { validateValue, type FieldDeclaration } from '../fields';
import type { Resource } from '../resource';

/** The value to store for a field. `storageOf` names the collection a reference's target is kept in. */
export function storedValue(declaration: FieldDeclaration, value: unknown, storageOf: (resourceId: string) => string): Value {
    if (value === null) return null;
    // A multiple field stores its items as the kind stores one.
    if (declaration.multiple) return (value as unknown[]).map(item => storedValue({ ...declaration, multiple: false }, item, storageOf));
    switch (declaration.kind) {
        case 'bigint': return BigInt(value as string | bigint);
        case 'number': return new Float64(value as number);
        case 'reference': return new RecordId(storageOf(declaration.target!), value as string);
        case 'vector': return Vector.float32(value as number[]);
        case 'json': case 'blocks': case 'richtext': case 'rows': return storedJson(value);
        default: return value as Value;
    }
}

/** A stored value as the application reads it: a reference is the key of its record. */
export function publicValue(declaration: FieldDeclaration, value: Value): unknown {
    if (value === null) return null;
    if (declaration.multiple) return Array.isArray(value) ? value.map(item => publicValue({ ...declaration, multiple: false }, item)) : [];
    switch (declaration.kind) {
        case 'integer': case 'datetime': return Number(value as bigint);
        case 'bigint': return String(value);
        case 'number': return value instanceof Float64 ? value.value : Number(value as bigint);
        case 'reference': return value instanceof RecordId ? String(value.key) : null;
        case 'json': case 'blocks': case 'richtext': case 'rows': return toJson(value);
        case 'vector': {
            const bytes = (value as Vector).bytes;
            return [...new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))];
        }
        default: return value;
    }
}

/** Plain JSON for storage: fractional numbers become explicit floats, integers stay int64. */
export function storedJson(value: unknown): Value {
    if (typeof value === 'number') return Number.isInteger(value) ? value : new Float64(value);
    if (Array.isArray(value)) return value.map(storedJson);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, storedJson(entry)]));
    return value as Value;
}

/** A stored nested value as plain JSON. */
export function toJson(value: Value): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Float64) return value.value;
    if (value instanceof RecordId) return `${value.table}:${String(value.key)}`;
    if (Array.isArray(value)) return value.map(toJson);
    if (value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof Vector)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJson(entry)]));
    }
    return value;
}

// --- The field values of a row -----------------------------------------------------------


/** Keys of a values document that are the host's bookkeeping, not values. */
const BOOKKEEPING = new Set(['id', '_rev', '_op', '_createdAt', '_updatedAt', '_owner', '_media']);
const quote = (name: string) => `"${name}"`;

export interface FieldValuesOptions {
    /** The internal resource whose fields these are, as it is now: the groups attached to the target change it. */
    readonly resource: () => Resource;
    /** The collection a reference's target is kept in. */
    readonly storageOf: (resourceId: string) => string;
    /** The media files a set of values names, kept beside them so "which rows use this file" is a filter. */
    readonly media?: (values: { readonly [field: string]: unknown }) => readonly string[];
    readonly now?: () => number;
}

/**
 * The field group values of rows that are not entries (users, terms), one document per row
 * under the row's ID, in the storage of an internal resource. A field is a field of the
 * document, stored as an entry's is, so the indexes the schema planner makes for the resource
 * apply. Its statements go into the caller's write, so a row and its values change together.
 *
 * A value that is cleared is unset, never set to null: RomeDB refuses null in the parent of
 * an indexed nested field (request Q2). Setting and unsetting are two statements (Q3).
 */
/**
 * The field whose unique index refused a write, from the engine's message, which names a
 * document index in hex. Undefined when the message is about something else.
 */
export function uniqueFieldOf(message: string): string | undefined {
    const index = /UNIQUE constraint failed: __romedb_i_([0-9a-f]+)/i.exec(message);
    if (!index) return undefined;
    return (index[1]!.match(/../g) ?? []).map(pair => String.fromCharCode(parseInt(pair, 16))).join('').split('__u_')[1] ?? '';
}

export class FieldValues {
    readonly #db: RomeDB;
    readonly #options: FieldValuesOptions;
    readonly #now: () => number;

    constructor(db: RomeDB, options: FieldValuesOptions) {
        this.#db = db;
        this.#options = options;
        this.#now = options.now ?? Date.now;
    }

    get storage(): string { return this.#options.resource().storage; }

    #id(key: string): RecordId { return new RecordId(this.storage, key); }

    #stored(name: string, value: unknown): Value {
        const declaration = this.#options.resource().fields[name];
        // A system value (`_recent_blocks`) has no declaration: it is kept as plain JSON.
        return declaration ? storedValue(declaration, value, this.#options.storageOf) : storedJson(value);
    }

    /**
     * Statements that make the row's values exactly `values`, given what it holds now
     * (`previous`; null for a new row): the document is made when missing, changed fields are
     * set, and fields no longer present are unset.
     */
    save(key: string, values: { readonly [field: string]: unknown }, previous: { readonly [field: string]: unknown } | null, op: string, guard?: { readonly rql: string; readonly params: { readonly [key: string]: Value } }): Statement[] {
        const now = this.#now();
        const id = this.#id(key);
        // The host's bookkeeping fields are never values.
        const present = Object.entries(values).filter(([name, value]) => !BOOKKEEPING.has(name) && value !== undefined && value !== null);
        const cleared = Object.keys(previous ?? {}).filter(name => !BOOKKEEPING.has(name) && (values[name] === undefined || values[name] === null));
        const media = this.#options.media ? [...new Set(this.#options.media(Object.fromEntries(present)))].sort() : [];
        const params: { [key: string]: Value } = { $id: id, $op: op, $now: now };
        const assignments = ['"_rev" = "_rev" + 1', '"_op" = $op', '"_updatedAt" = $now'];
        present.forEach(([name, value], index) => { params[`$v${index}`] = this.#stored(name, value); assignments.push(`${quote(name)} = $v${index}`); });
        if (media.length) { params.$media = media; assignments.push('"_media" = $media'); }
        // A guard is a condition on relational rows (the row these values belong to): a document write may carry one.
        const when = guard ? ` AND ${guard.rql}` : '';
        const guarded = guard?.params ?? {};
        return [
            // The document, when the row has none yet.
            { rql: `INSERT INTO ${this.storage} ("id", "_rev", "_op", "_createdAt", "_updatedAt") SELECT $id, 1, $op, $now, $now WHERE true${when} ON CONFLICT ("id") DO NOTHING`, params: { $id: id, $op: op, $now: now, ...guarded } },
            { rql: `UPDATE ${this.storage} SET ${assignments.join(', ')} WHERE id = $id${when}`, params: { ...params, ...guarded } },
            ...(cleared.length || !media.length ? [{ rql: `UPDATE ${this.storage} UNSET ${[...cleared, ...(media.length ? [] : ['_media'])].map(quote).join(', ')} WHERE id = $id${when}`, params: { $id: id, ...guarded } }] : []),
        ];
    }

    /** Set one value without reading the others, or unset it (null): two writers of different fields both keep theirs. */
    setOne(key: string, name: string, value: unknown, op: string): Statement[] {
        if (BOOKKEEPING.has(name)) throw new TypeError(`${name} is not a value.`);
        const now = this.#now();
        const id = this.#id(key);
        const ensure: Statement = { rql: `INSERT INTO ${this.storage} ("id", "_rev", "_op", "_createdAt", "_updatedAt") VALUES ($id, 1, $op, $now, $now) ON CONFLICT ("id") DO NOTHING`, params: { $id: id, $op: op, $now: now } };
        if (value === null || value === undefined) return [ensure, { rql: `UPDATE ${this.storage} UNSET ${quote(name)} WHERE id = $id`, params: { $id: id } }];
        return [ensure, { rql: `UPDATE ${this.storage} SET ${quote(name)} = $value, "_rev" = "_rev" + 1, "_op" = $op, "_updatedAt" = $now WHERE id = $id`, params: { $id: id, $value: this.#stored(name, value), $op: op, $now: now } }];
    }

    /** The statement that removes a row's values, for the write that removes the row. */
    remove(key: string): Statement {
        return { rql: `DELETE FROM ${this.storage} WHERE id = $id`, params: { $id: this.#id(key) } };
    }

    /** The statement that reads these rows' documents, 200 at most, for a read the caller batches. */
    readStatement(keys: readonly string[]): Statement {
        const params = Object.fromEntries(keys.map((key, index) => [`$k${index}`, this.#id(key) as Value]));
        return { rql: `SELECT * FROM ${this.storage} WHERE id IN (${keys.map((_, index) => `$k${index}`).join(', ')})`, params };
    }

    /** The values of each row, by key, from the rows of `readStatement`. A row without a document has none. */
    decode(rows: readonly (readonly Value[])[]): Map<string, { readonly [field: string]: unknown }> {
        const fields = this.#options.resource().fields;
        const result = new Map<string, { readonly [field: string]: unknown }>();
        for (const row of rows) {
            const document = row[0] as { [field: string]: Value } | null;
            if (!document || !(document.id instanceof RecordId)) continue;
            const values: { [field: string]: unknown } = {};
            for (const [name, value] of Object.entries(document)) {
                if (BOOKKEEPING.has(name) || value === null) continue;
                const declaration = Object.hasOwn(fields, name) ? fields[name] : undefined;
                if (!declaration) {
                    // The host's own values are kept as they are; a value of a field that is gone is not shown.
                    if (SYSTEM_META.test(name)) values[name] = toJson(value);
                    continue;
                }
                // A value from before its field changed reads as unset, as an entry's does.
                let shaped: unknown;
                try { shaped = publicValue(declaration, value); } catch { shaped = undefined; }
                if (shaped !== undefined && shaped !== null && validateValue(name, declaration, shaped) === undefined) values[name] = shaped;
            }
            result.set(String(document.id.key), Object.freeze(values));
        }
        return result;
    }

    async read(keys: readonly string[]): Promise<Map<string, { readonly [field: string]: unknown }>> {
        if (!keys.length) return new Map();
        // Documents can be large: the keys are read in as few requests as the result budget allows.
        return this.decode(await readByIds(this.#db, keys, slice => this.readStatement(slice)));
    }

    /** The keys of the rows whose values name this media file, 50 at most. */
    async usingFile(fileId: string): Promise<string[]> {
        const result = await this.#db.read([{ rql: `SELECT record::id(id) FROM ${this.storage} WHERE array::contains("_media", $file) LIMIT 50`, params: { $file: fileId } }]);
        return result.results[0]!.rows.map(row => String(row[0]));
    }
}
