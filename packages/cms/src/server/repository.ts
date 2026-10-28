/**
 * Resource repositories. Reads compile to bounded parameterized RomeQL with access
 * conditions. Each mutation is one atomic batch: the record statement, then revision,
 * audit and outbox rows guarded by the operation ID the record statement wrote, so a
 * zero-row edit writes nothing else. IDs are allocated before dispatch and the exact
 * request is saved for recovery.
 */
import { ClientError, Float64, RecordId, UncertainWriteError, Vector, type Statement, type Value } from '@cossackframework/romedb';
import type { HookRegistry } from '@cossackframework/core/hooks';
import { CmsError } from '../errors';
import { slugify, validateValue, type FieldDeclaration } from '../fields';
import { blockId, blockMedia, blocksPlain, flattenBlocks, validateBlocks, type Block } from '../blocks';
import { fieldVisibility, indexedRowField, rowIndexPath, rowsPlain, rowsSearchable, rowUniqueProblem, withRowIds } from '../field-groups';
import { normalizeRichText, richTextBlocks, richTextMedia, richTextPlain, withRichTextBlocks, type RichTextDoc } from '../richtext';
import { searchTextPath } from './schema';
import { afterCommit, beforeWrite, type Draft, type ResourceEvent, type WriteActor } from '../hooks';
import { hasPermission, principalId, ruleScope, type Principal, type RecordScope } from '../permissions';
import type { FieldFilter, ListFilter, ListOptions, RecordPage, RecordShape, RevisionShape } from '../records';

export type { FieldFilter, ListFilter, ListOptions };
import type { Resource, ResourceAction } from '../resource';
import type { CmsHost } from './host';

export interface OperationContext {
    readonly principal: Principal;
    readonly signal?: AbortSignal;
}

const KEY = /^[A-Za-z0-9_-]{1,80}$/;
/** Fields a restored revision does not change: where and whether the entry is published, and its translations. */
const KEPT_ON_RESTORE = new Set(['status', 'publishedAt', 'parent', 'menuOrder', 'locale', 'translationGroup', 'commentsOpen']);

/** RomeDB rejects unused bindings: keep only the parameters a statement references. */
export function bound(rql: string, params: { readonly [key: string]: Value }): Statement {
    const used = Object.entries(params).filter(([name]) => new RegExp(`\\${name}(?![A-Za-z0-9_])`).test(rql));
    return used.length ? { rql, params: Object.fromEntries(used) } : { rql };
}
const SCALAR = new Set(['string', 'enum', 'integer', 'number', 'boolean', 'datetime', 'reference', 'bigint']);
const RANGED = new Set(['integer', 'number', 'datetime']);
const ORDERED = new Set(['string', 'enum', 'integer', 'number', 'boolean', 'datetime', 'bigint']);
type Access = 'allow' | RecordScope;
const quote = (name: string) => `"${name}"`;

export class ResourceRepository {
    readonly #host: CmsHost;
    readonly #id: string;

    constructor(host: CmsHost, id: string) {
        this.#host = host;
        this.#id = id;
    }

    /** The current declaration. Collections change when an administrator edits them. */
    get resource(): Resource { return this.#host.resourceById(this.#id); }

    async get(id: string, context: OperationContext): Promise<RecordShape | null> {
        const access = await this.#authorize('read', context.principal);
        if (typeof id !== 'string' || !KEY.test(id)) return null;
        const { rql, params } = this.#conditions(access, context.principal, [`id = type::record('${this.resource.storage}', $key)`], { $key: id });
        const result = await this.#host.db.read([{ rql: `SELECT * FROM ${this.resource.storage} WHERE ${rql} LIMIT 1`, params }], this.#readOptions(context));
        const document = result.results[0]!.rows[0]?.[0] as Document | undefined;
        return document ? this.#public(document, context.principal) : null;
    }

    /** Records by ID in one read, for those the principal may read. Invalid IDs are skipped; at most 200. */
    async getMany(ids: readonly string[], context: OperationContext): Promise<Map<string, RecordShape>> {
        const access = await this.#authorize('read', context.principal);
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && KEY.test(id)))].slice(0, 200);
        if (!wanted.length) return new Map();
        const params: { [key: string]: Value } = {};
        const list = wanted.map((id, index) => { params[`$k${index}`] = id; return `type::record('${this.resource.storage}', $k${index})`; }).join(', ');
        const { rql, params: bound } = this.#conditions(access, context.principal, [`id IN (${list})`], params);
        const result = await this.#host.db.read([{ rql: `SELECT * FROM ${this.resource.storage} WHERE ${rql} LIMIT ${wanted.length}`, params: bound }], this.#readOptions(context));
        return new Map(result.results[0]!.rows.map(row => { const record = this.#public(row[0] as Document, context.principal); return [record.id, record]; }));
    }

    async list(options: ListOptions, context: OperationContext): Promise<RecordPage> {
        const access = await this.#authorize('read', context.principal);
        const limit = options.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CmsError('CMS_VALIDATION', 'limit must be 1..100.');
        const offset = options.offset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new CmsError('CMS_VALIDATION', 'offset must be 0..10000.');
        const params: { [key: string]: Value } = { $limit: limit + 1 };
        const conditions = this.#filters(options, context.principal, params);
        const order = this.#order(options.order);
        // Cursors page through the default order and through the creation or update time.
        const timed = !options.order ? '_updatedAt' : options.order.field === 'createdAt' ? '_createdAt' : options.order.field === 'updatedAt' ? '_updatedAt' : undefined;
        const ascending = options.order?.direction === 'asc';
        if (options.after !== undefined) {
            if (!timed || offset) throw new CmsError('CMS_VALIDATION', 'Cursors apply to the default order, or the creation or update time, without an offset.');
            const cursor = decodeCursor(options.after);
            params.$afterAt = cursor.at;
            params.$afterKey = cursor.key;
            const past = ascending ? '>' : '<';
            conditions.push(`("${timed}" ${past} $afterAt OR ("${timed}" = $afterAt AND record::id(id) ${past} $afterKey))`);
        }
        if (offset) params.$offset = offset;
        const where = this.#conditions(access, context.principal, conditions, params);
        const result = await this.#host.db.read([bound(
            `SELECT * FROM ${this.resource.storage}${where.rql ? ` WHERE ${where.rql}` : ''} ORDER BY ${order} LIMIT $limit${offset ? ' OFFSET $offset' : ''}`,
            where.params,
        )], this.#readOptions(context));
        const documents = result.results[0]!.rows.map(row => row[0] as Document);
        const page = documents.slice(0, limit).map(document => this.#public(document, context.principal));
        const last = documents.length > limit && timed && !offset ? documents[limit - 1]! : undefined;
        if (!last) return { records: page, ...(documents.length > limit ? { more: true } : {}) };
        const next = encodeCursor(Number(last[timed!]), (last.id as RecordId).key as string);
        return options.order ? { records: page, next, more: true } : { records: page, next };
    }

    /** Records matching a filter that the principal may read. */
    async count(filter: ListFilter, context: OperationContext): Promise<number> {
        return (await this.countMany([filter], context))[0]!;
    }

    /** Counts for several filters in one read, such as the status tabs of a list. */
    async countMany(filters: readonly ListFilter[], context: OperationContext): Promise<number[]> {
        const access = await this.#authorize('read', context.principal);
        if (filters.length < 1 || filters.length > 30) throw new CmsError('CMS_VALIDATION', 'Count 1-30 filters at a time.');
        const statements = filters.map(filter => {
            const params: { [key: string]: Value } = {};
            const where = this.#conditions(access, context.principal, this.#filters(filter, context.principal, params), params);
            return bound(`SELECT count(*) FROM ${this.resource.storage}${where.rql ? ` WHERE ${where.rql}` : ''}`, where.params);
        });
        const result = await this.#host.db.read(statements, this.#readOptions(context));
        return result.results.map(entry => Number(entry.rows[0]![0] as bigint));
    }

    /**
     * Full-text search over `search: true` fields. Owner-scoped readers search only their
     * records: allowed IDs are computed first and every hit is checked again in the same query.
     */
    async search(query: string, options: ListFilter & { limit?: number }, context: OperationContext): Promise<RecordShape[]> {
        const access = await this.#authorize('read', context.principal);
        if (!Object.values(this.resource.fields).some(field => field.search)) throw new CmsError('CMS_VALIDATION', `${this.resource.id} has no searchable fields.`);
        if (typeof query !== 'string' || !query.trim() || new TextEncoder().encode(query).byteLength > 4096) throw new CmsError('CMS_VALIDATION', 'Search needs 1-4096 bytes of text.');
        const limit = options.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CmsError('CMS_VALIDATION', 'limit must be 1..100.');
        const filtered = access !== 'allow' || options.where !== undefined || options.owner !== undefined;
        // Hits are checked again in the outer query; fetch more when some may be filtered out.
        const params: { [key: string]: Value } = { $query: query, $limit: filtered ? Math.min(limit * 4, 400) : limit };
        let source = `search::text('${this.resource.storage}__text', $query, $limit)`;
        if (access !== 'allow' && access.owner && !access.where.length) {
            const owned = await this.#host.db.read([{ rql: `SELECT id FROM ${this.resource.storage} WHERE "_owner" = $owner LIMIT 4097`, params: { $owner: principalId(context.principal) } }], this.#readOptions(context));
            if (owned.results[0]!.rows.length > 4096) throw new CmsError('CMS_LIMIT', 'Search over more than 4096 owned records needs a separate collection per owner.');
            params.$allowed = owned.results[0]!.rows.map(row => row[0]!);
            source = `search::text('${this.resource.storage}__text', $query, $limit, $allowed)`;
        }
        const where = this.#conditions(access, context.principal, this.#filters(options, context.principal, params, 'd.'), params, 'd.');
        const result = await this.#host.db.read([bound(
            `SELECT d FROM ${source} h JOIN ${this.resource.storage} d ON d.id = h.id${where.rql ? ` WHERE ${where.rql}` : ''} ORDER BY h.score DESC, h.id LIMIT ${limit}`,
            where.params,
        )], this.#readOptions(context));
        return result.results[0]!.rows.map(row => this.#public(row[0] as Document, context.principal));
    }

    async revisions(id: string, context: OperationContext, options: { limit?: number } = {}): Promise<RevisionShape[]> {
        const record = await this.get(id, context);
        if (!record) throw new CmsError('CMS_NOT_FOUND', 'Record not found.');
        const result = await this.#host.db.read([{
            rql: 'SELECT revision, at, actor, data FROM cms_revisions WHERE resource = $resource AND record_id = $key ORDER BY revision DESC LIMIT $limit',
            params: { $resource: this.resource.id, $key: id, $limit: options.limit ?? 50 },
        }], this.#readOptions(context));
        return result.results[0]!.rows.map(([revision, at, actor, data]) => ({
            revision: Number(revision), at: Number(at), actor: actor as string | null, data: this.#redact(JSON.parse(data as string) as RecordShape, context.principal),
        }));
    }

    /** One revision's snapshot of a record the principal can read, or null. */
    async revision(id: string, revision: number, context: OperationContext): Promise<RevisionShape | null> {
        const record = await this.get(id, context);
        if (!record) throw new CmsError('CMS_NOT_FOUND', 'Record not found.');
        if (!Number.isSafeInteger(revision) || revision < 1) return null;
        const result = await this.#host.db.read([{
            rql: 'SELECT revision, at, actor, data FROM cms_revisions WHERE resource = $resource AND record_id = $key AND revision = $revision',
            params: { $resource: this.resource.id, $key: id, $revision: revision },
        }], this.#readOptions(context));
        const row = result.results[0]!.rows[0];
        return row ? { revision: Number(row[0]), at: Number(row[1]), actor: row[2] as string | null, data: this.#redact(JSON.parse(row[3] as string) as RecordShape, context.principal) } : null;
    }

    /**
     * Copy a revision's content into a new revision. Status, publication time, slug, nesting,
     * language, comment setting and terms stay as they are; values that no longer fit a changed
     * field are left out.
     */
    async restore(id: string, revision: number, context: OperationContext & { readonly expectedRevision: number }): Promise<RecordShape> {
        const snapshot = await this.revision(id, revision, context);
        if (!snapshot) throw new CmsError('CMS_NOT_FOUND', 'Revision not found.');
        const patch: { [field: string]: unknown } = {};
        for (const [name, declaration] of Object.entries(this.resource.fields)) {
            if (KEPT_ON_RESTORE.has(name) || declaration.taxonomy || declaration.slugFrom) continue;
            if (declaration.access?.write && !hasPermission(context.principal, declaration.access.write)) continue;
            const value = snapshot.data[name];
            if (value === undefined || validateValue(name, declaration, value) !== undefined) continue;
            patch[name] = value;
        }
        return this.update(id, patch, context);
    }

    /** Whether the principal may update the record: its rule allows, or the record is in the rule's scope. */
    canUpdate(record: RecordShape, principal: Principal): boolean {
        const scope = ruleScope(this.resource.access.update, principal);
        if (scope === 'allow' || scope === 'deny') return scope === 'allow';
        if (scope.owner && principal.kind === 'user' && record.owner === principal.id) return true;
        return scope.where.some(rule => Object.entries(rule).every(([name, value]) => record[name] === value));
    }

    async create(input: { readonly [field: string]: unknown }, context: OperationContext & { readonly id?: string }): Promise<RecordShape> {
        const access = await this.#authorize('create', context.principal);
        // Only an owner rule lets a user create; a record condition cannot be checked before the record exists.
        if (access !== 'allow' && !(access.owner && context.principal.kind === 'user')) {
            throw new CmsError(context.principal.kind === 'user' ? 'CMS_FORBIDDEN' : 'CMS_UNAUTHENTICATED', `Not allowed to create ${this.resource.id}.`);
        }
        const key = context.id ?? crypto.randomUUID();
        checkKey(key);
        const draft = await this.#prepareDraft('create', null, input, null, context);
        const now = this.#host.now();
        const op = crypto.randomUUID();
        const owner = this.resource.ownership && context.principal.kind === 'user' ? context.principal.id : null;
        const record = this.#shape(key, 1, now, now, owner, draft);
        const document: { [field: string]: Value } = { id: new RecordId(this.resource.storage, key), _rev: 1, _op: op, _createdAt: now, _updatedAt: now, _owner: owner };
        for (const [name, value] of Object.entries(draft)) if (value !== undefined) document[name] = this.#store(name, this.resource.fields[name]!, value);
        for (const [path, text] of this.#searchText(draft)) document[path] = text;
        const statements: Statement[] = [{ rql: `INSERT INTO ${this.resource.storage} DOCUMENT $document`, params: { $document: document } }];
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $op)`;
        statements.push(...this.#sideEffects(guard, op, key, 1, 'create', record, context.principal, now));
        await this.#write(statements, op, context, error => {
            if (error.code === 'FDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'A record with the same unique value already exists.', { cause: error });
        });
        return this.#redact(record, context.principal);
    }

    /**
     * Insert a record the host writes for itself, such as a form submission. The declared
     * fields are checked, but no write hooks, revisions, audit rows or resource events run.
     * `attach` adds statements to the batch; its guard holds once the record is written.
     * The caller chooses the ID, the operation ID (the request ID) and the reconciler kind.
     */
    async insert(input: { readonly [field: string]: unknown }, context: OperationContext & {
        readonly id: string; readonly op: string; readonly owner: string | null; readonly kind: string;
        readonly attach?: (guard: { readonly rql: string; readonly params: { readonly [key: string]: Value } }) => readonly Statement[];
    }): Promise<RecordShape> {
        const access = await this.#authorize('create', context.principal);
        if (access !== 'allow') throw new CmsError(context.principal.kind === 'user' ? 'CMS_FORBIDDEN' : 'CMS_UNAUTHENTICATED', `Not allowed to create ${this.resource.id}.`);
        checkKey(context.id);
        const draft = this.#validate('create', input, null, context.principal);
        const now = this.#host.now();
        const owner = this.resource.ownership ? context.owner : null;
        const record = this.#shape(context.id, 1, now, now, owner, draft);
        const document: { [field: string]: Value } = { id: new RecordId(this.resource.storage, context.id), _rev: 1, _op: context.op, _createdAt: now, _updatedAt: now, _owner: owner };
        for (const [name, value] of Object.entries(draft)) if (value !== undefined) document[name] = this.#store(name, this.resource.fields[name]!, value);
        for (const [path, text] of this.#searchText(draft)) document[path] = text;
        const guard = { rql: `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $op)`, params: { $key: context.id, $op: context.op } };
        const statements: Statement[] = [{ rql: `INSERT INTO ${this.resource.storage} DOCUMENT $document`, params: { $document: document } }, ...(context.attach?.(guard) ?? [])];
        await this.#write(statements, context.op, context, error => {
            if (error.code === 'FDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'A record with the same unique value already exists.', { cause: error });
        }, 0, context.kind);
        return record;
    }

    /** Edit with an expected revision. A stale revision or lost access is a conflict, and nothing is written. */
    async update(id: string, patch: { readonly [field: string]: unknown }, context: OperationContext & { readonly expectedRevision: number }): Promise<RecordShape> {
        const access = await this.#authorize('update', context.principal);
        checkKey(id);
        if (!Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 1) throw new CmsError('CMS_VALIDATION', 'expectedRevision must be a positive integer.');
        const previous = await this.#current(id, access, context);
        if (!previous) throw new CmsError('CMS_NOT_FOUND', 'Record not found.');
        if (previous.rev !== context.expectedRevision) throw new CmsError('CMS_CONFLICT', 'The record changed since it was read. Reload and try again.');
        const draft = await this.#prepareDraft('update', id, patch, previous, context);
        const changed = Object.keys(draft).filter(name => draft[name] !== undefined);
        const now = this.#host.now();
        const op = crypto.randomUUID();
        const revision = previous.rev + 1;
        const record = this.#shape(id, revision, previous.createdAt, now, previous.owner, { ...this.#fieldsOf(previous), ...draft });
        const params: { [key: string]: Value } = { $key: id, $expected: context.expectedRevision, $op: op, $now: now };
        const assignments = changed.map((name, index) => {
            params[`$f${index}`] = this.#store(name, this.resource.fields[name]!, draft[name]);
            return `${quote(name)} = $f${index}`;
        });
        for (const [index, [path, text]] of this.#searchText(draft).entries()) {
            params[`$t${index}`] = text;
            assignments.push(`${quote(path)} = $t${index}`);
        }
        const condition = this.#conditions(access, context.principal, [`id = type::record('${this.resource.storage}', $key)`, '"_rev" = $expected'], params);
        const statements: Statement[] = [bound(
            `UPDATE ${this.resource.storage} SET ${[...assignments, '"_rev" = "_rev" + 1', '"_op" = $op', '"_updatedAt" = $now'].join(', ')} WHERE ${condition.rql}`,
            condition.params,
        )];
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $op)`;
        statements.push(...this.#sideEffects(guard, op, id, revision, 'update', record, context.principal, now, {}, previous));
        // A published entry whose URL changes keeps answering at the old one. The audit row,
        // written only when the change commits, guards these relational statements.
        statements.push(...await this.#host.redirectStatements(this.resource, previous, record, { rql: 'EXISTS (SELECT 1 FROM cms_audit WHERE id = $rOp)', params: { $rOp: op } }, principalId(context.principal)));
        const result = await this.#write(statements, op, context);
        if (result !== 1) throw new CmsError('CMS_CONFLICT', 'The record changed since it was read. Reload and try again.');
        return this.#redact(record, context.principal);
    }

    async delete(id: string, context: OperationContext & { readonly expectedRevision: number }): Promise<void> {
        const access = await this.#authorize('delete', context.principal);
        checkKey(id);
        if (!Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 1) throw new CmsError('CMS_VALIDATION', 'expectedRevision must be a positive integer.');
        const now = this.#host.now();
        const op = crypto.randomUUID();
        const condition = this.#conditions(access, context.principal, [`id = type::record('${this.resource.storage}', $key)`, '"_rev" = $expected'], { $key: id, $expected: context.expectedRevision });
        // Guards run before the delete, against the same snapshot.
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE ${condition.rql})`;
        const previous = this.resource.fields.status ? await this.#current(id, access, context) : null;
        const statements = this.#sideEffects(guard, op, id, context.expectedRevision, 'delete', null, context.principal, now, condition.params, previous);
        statements.push(bound(`DELETE FROM ${this.resource.storage} WHERE ${condition.rql}`, condition.params));
        const deleted = await this.#write(statements, op, context, undefined, statements.length - 1);
        if (deleted !== 1) throw new CmsError('CMS_CONFLICT', 'The record changed or was deleted since it was read.');
    }

    async #authorize(action: ResourceAction, principal: Principal): Promise<Access> {
        await this.#host.assertActive(this.resource, { fresh: action !== 'read' });
        const outcome = ruleScope(this.resource.access[action], principal);
        if (outcome === 'deny') throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', `Not allowed to ${action} ${this.resource.id}.`);
        return outcome;
    }

    /** Join conditions with the access scope: the principal's own records or those matching a rule's fields. */
    #conditions(access: Access, principal: Principal, conditions: string[], params: { [key: string]: Value }, prefix = ''): { rql: string; params: { [key: string]: Value } } {
        if (access !== 'allow') {
            const scope: string[] = [];
            params = { ...params };
            if (access.owner && principal.kind === 'user') {
                scope.push(`${prefix}"_owner" = $owner`);
                params.$owner = principalId(principal);
            }
            access.where.forEach((rule, ruleIndex) => {
                const parts = Object.entries(rule).map(([name, value], index) => {
                    params[`$a${ruleIndex}_${index}`] = value;
                    return `${prefix}${quote(name)} = $a${ruleIndex}_${index}`;
                });
                scope.push(parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0]!);
            });
            conditions = [...conditions, scope.length ? scope.join(' OR ') : '1 = 0'];
        }
        return { rql: conditions.map(condition => conditions.length > 1 ? `(${condition})` : condition).join(' AND '), params };
    }

    /** RomeQL conditions for a filter. Parameters are added to `params`. */
    #filters(filter: ListFilter, principal: Principal, params: { [key: string]: Value }, prefix = ''): string[] {
        const conditions: string[] = [];
        let index = Object.keys(params).filter(name => name.startsWith('$w')).length;
        const parameter = (value: Value) => { const name = `$w${index++}`; params[name] = value; return name; };
        for (const [given, condition] of Object.entries(filter.where ?? {})) {
            // A row field, as `specs.name`, filters through the array index on its path into the rows.
            if (given.includes('.')) {
                const path = given.split('.');
                const row = indexedRowField(this.resource.fields, path);
                if (!row || !this.#canRead(path[0]!, principal)) throw new CmsError('CMS_VALIDATION', `Cannot filter on ${given}.`);
                const values = condition !== null && typeof condition === 'object' && 'contains' in condition ? [condition.contains]
                    : condition !== null && typeof condition === 'object' && 'containsAny' in condition ? [...condition.containsAny] : undefined;
                if (!values || !values.length || values.length > 50) throw new CmsError('CMS_VALIDATION', `Filter ${given} with contains or containsAny (1-50 values).`);
                const column = prefix + rowIndexPath(path).split('.').map(part => part === '*' ? part : quote(part)).join('.');
                conditions.push(values.map(value => {
                    const error = validateValue(given, row, value);
                    if (error) throw new CmsError('CMS_VALIDATION', `Filter ${given} ${error}`, { fields: { [given]: error } });
                    return `array::contains(${column}, ${parameter(storedJson(value))})`;
                }).join(' OR '));
                continue;
            }
            const name = given;
            const declaration = this.resource.fields[name];
            if (!declaration || !this.#canRead(name, principal)) throw new CmsError('CMS_VALIDATION', `Cannot filter on ${given}.`);
            const column = `${prefix}${quote(name)}`;
            const check = (value: unknown, kind: FieldDeclaration = declaration) => {
                const error = validateValue(name, kind, value);
                if (error) throw new CmsError('CMS_VALIDATION', `Filter ${name} ${error}`, { fields: { [name]: error } });
            };
            if (declaration.kind === 'list') {
                const values = condition !== null && typeof condition === 'object' && 'contains' in condition ? [condition.contains]
                    : condition !== null && typeof condition === 'object' && 'containsAny' in condition ? [...condition.containsAny] : undefined;
                if (!values || !values.length || values.length > 50 || !declaration.index) throw new CmsError('CMS_VALIDATION', `Filter ${name} with contains or containsAny (1-50 values) on an indexed list.`);
                const item: FieldDeclaration = { kind: declaration.items as FieldDeclaration['kind'] };
                conditions.push(values.map(value => {
                    check(value, item);
                    return `array::contains(${column}, ${parameter(declaration.items === 'number' ? new Float64(value as number) : value as Value)})`;
                }).join(' OR '));
                continue;
            }
            if (!SCALAR.has(declaration.kind)) throw new CmsError('CMS_VALIDATION', `Cannot filter on ${name}.`);
            if (condition === null) { conditions.push(`${column} IS NULL`); continue; }
            if (typeof condition !== 'object') {
                check(condition);
                conditions.push(`${column} = ${parameter(this.#store(name, declaration, condition))}`);
                continue;
            }
            if ('ne' in condition) {
                if (condition.ne === null) { conditions.push(`${column} IS NOT NULL`); continue; }
                check(condition.ne);
                conditions.push(`(${column} IS NULL OR ${column} != ${parameter(this.#store(name, declaration, condition.ne))})`);
            } else if ('in' in condition) {
                if (!Array.isArray(condition.in) || !condition.in.length || condition.in.length > 100) throw new CmsError('CMS_VALIDATION', `Filter ${name} with 1-100 values.`);
                conditions.push(`${column} IN (${condition.in.map(value => { check(value); return parameter(this.#store(name, declaration, value)); }).join(', ')})`);
            } else {
                const bounds = Object.entries(condition) as [string, unknown][];
                if (!RANGED.has(declaration.kind) || !bounds.length || bounds.some(([operator]) => !['gt', 'gte', 'lt', 'lte'].includes(operator))) throw new CmsError('CMS_VALIDATION', `Cannot filter ${name} that way.`);
                for (const [operator, value] of bounds) {
                    check(value);
                    conditions.push(`${column} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator]} ${parameter(this.#store(name, declaration, value))}`);
                }
            }
        }
        if (filter.owner !== undefined) {
            if (!this.resource.ownership || typeof filter.owner !== 'string' || !KEY.test(filter.owner)) throw new CmsError('CMS_VALIDATION', 'Cannot filter on the owner.');
            conditions.push(`${prefix}"_owner" = ${parameter(filter.owner)}`);
        }
        return conditions;
    }

    #order(order: ListOptions['order']): string {
        if (!order) return '"_updatedAt" DESC, record::id(id) DESC';
        const direction = order.direction === 'asc' ? 'ASC' : order.direction === undefined || order.direction === 'desc' ? 'DESC' : undefined;
        const system = order.field === 'createdAt' ? '"_createdAt"' : order.field === 'updatedAt' ? '"_updatedAt"' : undefined;
        const declared = this.resource.fields[order.field];
        if (!direction || (!system && (!declared || !ORDERED.has(declared.kind)))) throw new CmsError('CMS_VALIDATION', `Cannot sort by ${order.field}.`);
        return `${system ?? quote(order.field)} ${direction}, record::id(id) ${direction}`;
    }

    async #current(id: string, access: Access, context: OperationContext): Promise<RecordShape | null> {
        const { rql, params } = this.#conditions(access, context.principal, [`id = type::record('${this.resource.storage}', $key)`], { $key: id });
        const result = await this.#host.db.read([{ rql: `SELECT * FROM ${this.resource.storage} WHERE ${rql} LIMIT 1`, params }], this.#readOptions(context));
        const document = result.results[0]!.rows[0]?.[0] as Document | undefined;
        return document ? this.#shapeOf(document) : null;
    }

    async #prepareDraft(action: 'create' | 'update', id: string | null, input: { readonly [field: string]: unknown }, previous: RecordShape | null, context: OperationContext): Promise<Draft> {
        const draft = this.#validate(action, input, previous, context.principal);
        let filtered: Draft;
        try {
            filtered = await this.#host.hooks.applyFilters(beforeWrite, draft, { resource: this.resource.id, action, id, previous, actor: actor(context.principal) }, context.signal ? { signal: context.signal } : {});
        } catch (error) {
            const cause = (error as { cause?: unknown }).cause;
            throw new CmsError('CMS_VALIDATION', cause instanceof Error ? cause.message : 'A plugin rejected the change.', { cause: error });
        }
        // Filters can change values; validate the result again.
        const final = filtered === draft ? draft : this.#validate(action, filtered, previous, context.principal);
        await this.#checkReferences(final, id);
        await this.#checkTemplate(final, previous);
        return this.#uniqueSlugs(final, id, context);
    }

    /** Terms, media and parent records named by the draft must exist; a record cannot be its own ancestor. */
    async #checkReferences(draft: Draft, id: string | null): Promise<void> {
        for (const [name, value] of Object.entries(draft)) {
            const declaration = this.resource.fields[name]!;
            if (value === null || value === undefined) continue;
            if (declaration.taxonomy) await this.#host.taxonomies.assertTerms(declaration.taxonomy, value as string[], name);
            const files = declaration.media ? (Array.isArray(value) ? value as string[] : [value as string])
                : declaration.kind === 'blocks' ? blockMedia(value as Block[], this.#host.blockTypes)
                : declaration.kind === 'richtext' ? [...richTextMedia(value as RichTextDoc), ...blockMedia(richTextBlocks(value as RichTextDoc), this.#host.blockTypes)]
                : declaration.fields ? groupMedia(declaration, value as { [key: string]: unknown }) : [];
            if (files.length) {
                const unique = [...new Set(files)];
                if (unique.length > 100) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} names too many files.`, { fields: { [name]: 'names too many files.' } });
                const list = unique.map((_, index) => `$m${index}`).join(', ');
                const found = await this.#host.db.read([{ rql: `SELECT count(*) FROM cms_files WHERE status = 'ready' AND id IN (${list})`, params: Object.fromEntries(unique.map((file, index) => [`$m${index}`, file])) }]);
                if (Number(found.results[0]!.rows[0]![0] as bigint) !== unique.length) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} names a missing file.`, { fields: { [name]: 'names a missing file.' } });
            }
            if (declaration.kind === 'reference' && declaration.target === this.resource.id) {
                // Walk up from the new parent; reaching this record would make a cycle.
                let current: string | null = value as string;
                for (let depth = 0; current; depth++) {
                    if (current === id) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} cannot be this record or one below it.`, { fields: { [name]: 'would make a cycle.' } });
                    if (depth >= 32) throw new CmsError('CMS_LIMIT', 'Records nest at most 32 levels deep.');
                    const row: Value | undefined = (await this.#host.db.read([{ rql: `SELECT ${quote(name)} FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key)`, params: { $key: current } }])).results[0]!.rows[0]?.[0];
                    if (row === undefined) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} names a missing record.`, { fields: { [name]: 'names a missing record.' } });
                    current = row instanceof RecordId ? String(row.key) : null;
                }
            }
        }
    }

    /**
     * An entry's chosen template must be one of the active theme's when it changes. A value
     * the theme no longer has, as after a theme switch, stays: the site falls back silently.
     */
    async #checkTemplate(draft: Draft, previous: RecordShape | null): Promise<void> {
        const value = draft.template;
        if (this.resource.owner !== 'cms' || !this.resource.fields.template || typeof value !== 'string' || !value || value === previous?.template) return;
        if (!(await this.#host.entryTemplates()).includes(value)) {
            throw new CmsError('CMS_VALIDATION', `${value} is not a template of the active theme.`, { fields: { template: 'is not a template of the active theme.' } });
        }
    }

    /** Unique slug fields get the first free `-2`, `-3`, … suffix, so a duplicate title does not fail the write. */
    async #uniqueSlugs(draft: Draft, id: string | null, context: OperationContext): Promise<Draft> {
        let adjusted: { [field: string]: unknown } | undefined;
        for (const [name, declaration] of Object.entries(this.resource.fields)) {
            const value = draft[name];
            if (!declaration.slugFrom || !declaration.unique || typeof value !== 'string' || !value) continue;
            const params: { [key: string]: Value } = { $slug: value, $prefix: `${value}-%`, ...(id ? { $key: id } : {}) };
            const result = await this.#host.db.read([{
                rql: `SELECT ${quote(name)} FROM ${this.resource.storage} WHERE (${quote(name)} = $slug OR ${quote(name)} LIKE $prefix)${id ? ' AND record::id(id) != $key' : ''} LIMIT 1000`, params,
            }], this.#readOptions(context));
            const taken = new Set(result.results[0]!.rows.map(row => row[0] as string));
            // Entries at the site root share one namespace with routes and other root collections.
            for (const slug of await this.#host.rootSlugConflicts(this.resource.id, value)) taken.add(slug);
            if (!taken.has(value)) continue;
            let suffix = 2;
            while (taken.has(`${value}-${suffix}`)) suffix++;
            const max = declaration.max ?? 200;
            const base = value.length + String(suffix).length + 1 > max ? value.slice(0, max - String(suffix).length - 1).replace(/-+$/, '') : value;
            adjusted = { ...(adjusted ?? draft), [name]: `${base}-${suffix}` };
        }
        return adjusted ? Object.freeze(adjusted) : draft;
    }

    #validate(action: 'create' | 'update', input: { readonly [field: string]: unknown }, previous: RecordShape | null, principal: Principal): Draft {
        if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new CmsError('CMS_VALIDATION', 'Record input must be an object.');
        const errors: { [field: string]: string } = {};
        const draft: { [field: string]: unknown } = {};
        const generate = new Set<string>();
        // A field the layout's conditions hide may come back null, as a write filter sees it.
        const hiddenBefore = this.#hiddenFields(previous, { ...input });
        for (const [name, value] of Object.entries(input)) {
            const declaration = this.resource.fields[name];
            if (!declaration) { errors[name] = 'is not a field of this resource.'; continue; }
            if (value === undefined) continue;
            if (value === null && hiddenBefore.has(name)) { draft[name] = null; continue; }
            // An empty slug is derived from its source field below.
            if (declaration.slugFrom && (value === '' || value === null)) { generate.add(name); continue; }
            if (declaration.access?.write && !hasPermission(principal, declaration.access.write)) { errors[name] = 'cannot be changed by you.'; continue; }
            const error = validateValue(name, declaration, value);
            if (error) { errors[name] = error; continue; }
            if (declaration.kind === 'blocks') {
                // Each block's data is checked against its type's fields; defaults fill gaps.
                const checked = validateBlocks(value as Block[], this.#host.blockTypes, { ...(declaration.blocks ? { allowed: declaration.blocks } : {}), form: declaration.form === true });
                const [path, message] = Object.entries(checked.errors)[0] ?? [];
                if (path) { errors[name] = `block ${path} ${message}`; continue; }
                draft[name] = checked.blocks;
                continue;
            }
            if (declaration.kind === 'rows') {
                // Rows get IDs the editor did not give; unique row fields are unique within the record.
                const rows = withRowIds(declaration, value, () => blockId());
                const unique = rowUniqueProblem(name, declaration, rows);
                if (unique) { errors[name] = unique.slice(name.length + 2); continue; }
                draft[name] = rows;
                continue;
            }
            if (declaration.kind === 'richtext') {
                // A clean copy of the document; embedded blocks are checked like a blocks field.
                const doc = normalizeRichText(value);
                const checked = validateBlocks(richTextBlocks(doc), this.#host.blockTypes, declaration.blocks ? { allowed: declaration.blocks } : {});
                const [path, message] = Object.entries(checked.errors)[0] ?? [];
                if (path) { errors[name] = `block ${path} ${message}`; continue; }
                draft[name] = withRichTextBlocks(doc, checked.blocks);
                continue;
            }
            draft[name] = value;
        }
        for (const [name, declaration] of Object.entries(this.resource.fields)) {
            if (!declaration.slugFrom || errors[name] || !(generate.has(name) || (action === 'create' && draft[name] === undefined))) continue;
            const source = draft[declaration.slugFrom] ?? previous?.[declaration.slugFrom];
            draft[name] = slugify(typeof source === 'string' ? source : '', declaration.max ?? 200) || 'untitled';
        }
        // Fields the layout's conditions hide are not required and are cleared, rows included.
        const hidden = this.#hiddenFields(previous, draft);
        if (action === 'create') {
            for (const [name, declaration] of Object.entries(this.resource.fields)) {
                if (draft[name] === undefined && declaration.default !== undefined) draft[name] = declaration.default;
                if (declaration.required && draft[name] === undefined && !errors[name] && !hidden.has(name)) errors[name] = 'is required.';
            }
        } else if (previous) {
            for (const [name, declaration] of Object.entries(this.resource.fields)) {
                if (declaration.required && Object.hasOwn(input, name) && input[name] === null && !hidden.has(name)) errors[name] = 'is required.';
            }
        }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Some fields are invalid.', { fields: errors });
        for (const name of hidden) draft[name] = action === 'create' ? undefined : null;
        return Object.freeze(draft);
    }

    /**
     * Top-level fields the layout's conditions hide for the record as it would be after the
     * draft; rows in the draft lose the values hidden inside them in place.
     */
    #hiddenFields(previous: RecordShape | null, draft: { [field: string]: unknown }): Set<string> {
        const layout = this.resource.layout;
        if (!layout?.length) return new Set();
        const values: { [field: string]: unknown } = { ...(previous ? this.#fieldsOf(previous) : {}), ...draft };
        const { hidden, values: cleared } = fieldVisibility(layout, this.#host.blockTypes, values);
        const names = new Map(flattenBlocks(layout).map(block => [block.id, typeof block.data.name === 'string' ? block.data.name : '']));
        const top = new Set<string>();
        for (const key of hidden) {
            if (key.includes('/')) continue;
            const name = names.get(key);
            if (name && Object.hasOwn(this.resource.fields, name)) top.add(name);
        }
        for (const [name, declaration] of Object.entries(this.resource.fields)) if (declaration.kind === 'rows' && draft[name] !== undefined && !top.has(name)) draft[name] = cleared[name] ?? draft[name];
        return top;
    }

    #sideEffects(guard: string, op: string, key: string, revision: number, action: 'create' | 'update' | 'delete', record: RecordShape | null, principal: Principal, now: number, extra: { [key: string]: Value } = {}, previous: RecordShape | null = null): Statement[] {
        const params = { ...extra, $key: key, $op: op, $resource: this.resource.id, $revision: revision, $actor: principalId(principal), $at: now };
        const statements: Statement[] = [];
        if (this.resource.revisions && record) {
            statements.push(bound(
                `INSERT INTO cms_revisions (id, resource, record_id, revision, data, actor, at) SELECT $revisionId, $resource, $key, $revision, $data, $actor, $at WHERE ${guard}`,
                { ...params, $revisionId: `${this.resource.id}:${key}:${revision}`, $data: JSON.stringify(record) },
            ));
        }
        statements.push(bound(
            `INSERT INTO cms_audit (id, actor, action, resource, record_id, revision, at) SELECT $op, $actor, $action, $resource, $key, $revision, $at WHERE ${guard}`,
            { ...params, $action: action },
        ));
        const event: ResourceEvent = {
            eventId: op, topic: action === 'create' ? 'resource.created' : action === 'update' ? 'resource.updated' : 'resource.deleted',
            resource: this.resource.id, id: key, revision, actor: actor(principal), at: now, record,
            ...(this.resource.fields.status ? { previousStatus: typeof previous?.status === 'string' ? previous.status : null } : {}),
        };
        statements.push(bound(
            `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) SELECT $op, $topic, $payload, $at, $at, 0, 0 WHERE ${guard}`,
            { ...params, $topic: event.topic, $payload: JSON.stringify(event) },
        ));
        return statements;
    }

    async #write(statements: Statement[], op: string, context: OperationContext, onRolledBack?: (error: ClientError) => void, statement = 0, kind = 'cms.resource.write'): Promise<number> {
        try {
            const result = await this.#host.db.write(statements, { requestId: op, kind, ...(context.signal ? { signal: context.signal } : {}), workLimits: this.#host.writeLimits });
            this.#host.outboxWritten();
            return Number(result.results[statement]!.affected);
        } catch (error) {
            if (error instanceof UncertainWriteError) throw new CmsError('CMS_UNCERTAIN', 'The change was sent but not confirmed. It will be completed or reported shortly.', { requestId: error.requestId, cause: error });
            if (error instanceof ClientError && error.outcome === 'rolled-back') {
                if (error.code === 'FDB_WRITE_CONFLICT') throw new CmsError('CMS_CONFLICT', 'The record changed since it was read. Reload and try again.', { cause: error });
                onRolledBack?.(error);
                if (error.code === 'FDB_VALIDATION' || error.code === 'FDB_CONSTRAINT') throw new CmsError('CMS_VALIDATION', 'The database rejected the values.', { cause: error });
            }
            throw error;
        }
    }

    #readOptions(context: OperationContext) {
        return { ...(context.signal ? { signal: context.signal } : {}), workLimits: this.#host.readLimits };
    }

    #store(name: string, declaration: FieldDeclaration, value: unknown): Value {
        if (value === null) return null;
        switch (declaration.kind) {
            case 'bigint': return BigInt(value as string | bigint);
            case 'number': return new Float64(value as number);
            case 'reference': return new RecordId(this.#host.resourceById(declaration.target!).storage, value as string);
            case 'list': return declaration.items === 'number' ? (value as number[]).map(item => new Float64(item)) : value as Value;
            case 'vector': return Vector.float32(value as number[]);
            case 'json': case 'blocks': case 'richtext': case 'rows': return storedJson(value);
            default: return value as Value;
        }
    }

    /** Plain text of the draft's searchable rich text and blocks fields, at their search paths. */
    #searchText(draft: Draft): [string, string | null][] {
        return Object.entries(this.resource.fields)
            .filter(([name, declaration]) => (((declaration.kind === 'richtext' || declaration.kind === 'blocks') && declaration.search) || rowsSearchable(declaration)) && draft[name] !== undefined)
            .map(([name, declaration]) => [searchTextPath(name), draft[name] === null ? null
                : declaration.kind === 'blocks' ? blocksPlain(draft[name] as Block[], this.#host.blockTypes, doc => richTextPlain(doc))
                : declaration.kind === 'rows' ? rowsPlain(declaration, draft[name]) : richTextPlain(draft[name] as RichTextDoc)]);
    }

    #shapeOf(document: Document): RecordShape {
        const fields: { [field: string]: unknown } = {};
        const schemaless = this.resource.schemaless;
        for (const [name, declaration] of Object.entries(this.resource.fields)) {
            const value = document[name];
            if (value === undefined) { fields[name] = declaration.default ?? null; continue; }
            if (!schemaless) { fields[name] = publicValue(declaration, value); continue; }
            // A schemaless record can hold a value from before its field changed; it reads as the default.
            let shaped: unknown;
            try { shaped = publicValue(declaration, value); } catch { shaped = undefined; }
            fields[name] = shaped === undefined || (shaped !== null && validateValue(name, declaration, shaped) !== undefined) ? declaration.default ?? null : shaped;
        }
        const id = document.id as RecordId;
        return this.#shape(String(id.key), Number(document._rev), Number(document._createdAt), Number(document._updatedAt), (document._owner as string | null | undefined) ?? null, fields);
    }

    #public(document: Document, principal: Principal): RecordShape {
        return this.#redact(this.#shapeOf(document), principal);
    }

    #shape(id: string, rev: number, createdAt: number, updatedAt: number, owner: string | null, fields: { readonly [field: string]: unknown }): RecordShape {
        const shape: { [field: string]: unknown } = { id, rev, createdAt, updatedAt, owner };
        for (const name of Object.keys(this.resource.fields)) shape[name] = fields[name] === undefined ? this.resource.fields[name]!.default ?? null : fields[name];
        return Object.freeze(shape) as RecordShape;
    }

    #fieldsOf(record: RecordShape): { [field: string]: unknown } {
        return Object.fromEntries(Object.keys(this.resource.fields).map(name => [name, record[name]]));
    }

    #canRead(name: string, principal: Principal): boolean {
        const permission = this.resource.fields[name]?.access?.read;
        return !permission || hasPermission(principal, permission);
    }

    /** Remove fields the principal may not read. */
    #redact(record: RecordShape, principal: Principal): RecordShape {
        const hidden = Object.keys(this.resource.fields).filter(name => !this.#canRead(name, principal));
        if (!hidden.length) return record;
        const copy: { [field: string]: unknown } = { ...record };
        for (const name of hidden) delete copy[name];
        return Object.freeze(copy) as RecordShape;
    }
}

type Document = { [field: string]: Value };

function publicValue(declaration: FieldDeclaration, value: Value): unknown {
    if (value === null) return null;
    switch (declaration.kind) {
        case 'integer': case 'datetime': return Number(value as bigint);
        case 'bigint': return String(value);
        case 'number': return value instanceof Float64 ? value.value : Number(value as bigint);
        case 'reference': return value instanceof RecordId ? String(value.key) : null;
        case 'json': case 'blocks': case 'richtext': case 'rows': return toJson(value);
        case 'list': return (value as Value[]).map(item => declaration.items === 'number' ? (item instanceof Float64 ? item.value : Number(item as bigint))
            : declaration.items === 'integer' ? Number(item as bigint) : item);
        case 'vector': {
            const bytes = (value as Vector).bytes;
            return [...new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))];
        }
        default: return value;
    }
}

/** Plain JSON for storage: fractional numbers become explicit floats, integers stay int64. */
function storedJson(value: unknown): Value {
    if (typeof value === 'number') return Number.isInteger(value) ? value : new Float64(value);
    if (Array.isArray(value)) return value.map(storedJson);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, storedJson(entry)]));
    return value as Value;
}

function toJson(value: Value): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Float64) return value.value;
    if (value instanceof RecordId) return value.toString();
    if (Array.isArray(value)) return value.map(toJson);
    if (value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof Vector)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJson(entry)]));
    }
    return value;
}

/** Media IDs in a group field's media subfields. */
function groupMedia(declaration: FieldDeclaration, value: { readonly [key: string]: unknown }): string[] {
    return Object.entries(declaration.fields ?? {}).filter(([, nested]) => nested.media).flatMap(([key]) => {
        const entry = value[key];
        return typeof entry === 'string' && entry ? [entry] : Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string') : [];
    });
}

function actor(principal: Principal): WriteActor {
    return { kind: principal.kind, id: principalId(principal) };
}

function checkKey(id: string): void {
    if (typeof id !== 'string' || !KEY.test(id)) throw new CmsError('CMS_VALIDATION', 'Record IDs are 1-80 letters, digits, underscores or hyphens.');
}

function encodeCursor(at: number, key: string): string {
    return btoa(JSON.stringify([at, key])).replaceAll('=', '');
}

function decodeCursor(cursor: string): { at: number; key: string } {
    try {
        const [at, key] = JSON.parse(atob(cursor)) as [unknown, unknown];
        if (Number.isSafeInteger(at) && typeof key === 'string' && KEY.test(key)) return { at: at as number, key };
    } catch { /* invalid below */ }
    throw new CmsError('CMS_VALIDATION', 'Invalid page cursor.');
}

export { afterCommit };
