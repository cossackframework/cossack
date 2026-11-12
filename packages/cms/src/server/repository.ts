/**
 * Resource repositories. Reads compile to bounded parameterized RomeQL with access
 * conditions. Each mutation is one atomic batch: the record statement, then revision,
 * audit and outbox rows guarded by the operation ID the record statement wrote, so a
 * zero-row edit writes nothing else. IDs are allocated before dispatch and the exact
 * request is saved for recovery.
 */
import { ClientError, Float64, MAX_STATEMENTS, RecordId, RequestTooLargeError, statementBytes, UncertainWriteError, Vector, type Statement, type Value } from '@cossackframework/romedb';
import { LIBRARY_KEYS } from './files';
import type { HookRegistry } from '@cossackframework/core/hooks';
import { CmsError, isCmsError } from '../errors';
import { translationGroupOf } from '../collections';
import { FIELD_NAME, slugify, validateValue, type FieldDeclaration } from '../fields';
import { blockId, blockMedia, blocksPlain, flattenBlocks, htmlBlocksChanged, textFieldProblem, validateBlocks, type Block } from '../blocks';
import { fieldVisibility, indexedRowField, rowIndexPath, rowsPlain, rowsSearchable, rowUniqueProblem, withRowIds } from '../field-groups';
import { normalizeRichText, richTextBlocks, richTextMedia, richTextPlain, withRichTextBlocks, type RichTextDoc } from '../richtext';
import { searchedAsText, searchTextPath } from './schema';
import { isSearchSyntaxError, searchQuery } from '../search';
import { afterCommit, beforeWrite, type Draft, type ResourceEvent, type WriteActor } from '../hooks';
import { sharedOp, type SharedFieldsEvent } from './shared-fields';
import { readPaged } from './budget';
import { isLockedRecord, lockedView } from './locked';
import { ANONYMOUS, evaluateRule, hasPermission, PERMISSIONS, principalId, ruleScope, type Principal, type RecordScope } from '../permissions';
import type { FieldFilter, ListFilter, ListOptions, RecordPage, RecordShape, RevisionShape } from '../records';

export type { FieldFilter, ListFilter, ListOptions };
import type { AccessRule, Resource, ResourceAction } from '../resource';
import type { CmsHost } from './host';
import { uuidv7 } from '@cossackframework/core';

export interface OperationContext {
    readonly principal: Principal;
    readonly signal?: AbortSignal;
}

/**
 * The translation group a create may join: set only by `translateEntry`, which owns joining a
 * group (rule 3 of specs/cms-invariants.md). A client-set group is refused.
 */
export const JOIN_GROUP: unique symbol = Symbol('cms.joinGroup');

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
        const result = await this.#host.db.read([this.#one(id, access, context.principal)], this.#readOptions(context));
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
        const where = this.#conditions(access, context.principal, conditions, params);
        // Whole documents: a page of long entries can pass the result budget, so it may come in smaller reads.
        const rows = await readPaged(this.#host.db, (size, at) => bound(
            `SELECT * FROM ${this.resource.storage}${where.rql ? ` WHERE ${where.rql}` : ''} ORDER BY ${order} LIMIT $limit OFFSET $offset`,
            { ...where.params, $limit: size, $offset: at },
        ), limit + 1, offset, this.#readOptions(context));
        const documents = rows.map(row => row[0] as Document);
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
     * Full-text search over `search: true` fields, for what a person typed (`searchQuery`): every
     * word by default, any word with `match: 'any'`. Empty when nothing searchable was typed.
     * Owner-scoped readers search only their records: allowed IDs are computed first and every
     * hit is checked again in the same query. `offset + limit` stays within RomeDB's 10000 hits.
     */
    async search(query: string, options: ListFilter & { limit?: number; offset?: number; match?: 'all' | 'any' }, context: OperationContext): Promise<RecordShape[]> {
        const access = await this.#authorize('read', context.principal);
        if (!Object.values(this.resource.fields).some(field => field.search)) throw new CmsError('CMS_VALIDATION', `${this.resource.id} has no searchable fields.`);
        if (typeof query !== 'string') throw new CmsError('CMS_VALIDATION', 'Search needs text.');
        const limit = options.limit ?? 20;
        const offset = options.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CmsError('CMS_VALIDATION', 'limit must be 1..200.');
        if (!Number.isInteger(offset) || offset < 0 || offset + limit > 10_000) throw new CmsError('CMS_VALIDATION', 'Search reaches the first 10000 results.');
        const parsed = searchQuery(query);
        if (!parsed) return [];
        const text = options.match === 'any' ? parsed.any ?? parsed.all : parsed.all;
        const filtered = access !== 'allow' || options.where !== undefined || options.owner !== undefined;
        // Hits are checked again in the outer query; fetch more when some may be filtered out.
        const params: { [key: string]: Value } = { $query: text, $limit: Math.min(filtered ? (offset + limit) * 4 : offset + limit, 10_000) };
        let source = `search::text('${this.resource.storage}__text', $query, $limit)`;
        if (access !== 'allow' && access.owner && !access.where.length) {
            const owned = await this.#host.db.read([{ rql: `SELECT id FROM ${this.resource.storage} WHERE "_owner" = $owner LIMIT 4097`, params: { $owner: principalId(context.principal) } }], this.#readOptions(context));
            if (owned.results[0]!.rows.length > 4096) throw new CmsError('CMS_LIMIT', 'Search over more than 4096 owned records needs a separate collection per owner.');
            params.$allowed = owned.results[0]!.rows.map(row => row[0]!);
            source = `search::text('${this.resource.storage}__text', $query, $limit, $allowed)`;
        }
        const where = this.#conditions(access, context.principal, this.#filters(options, context.principal, params, 'd.'), params, 'd.');
        const result = await this.#host.db.read([bound(
            `SELECT d FROM ${source} h JOIN ${this.resource.storage} d ON d.id = h.id${where.rql ? ` WHERE ${where.rql}` : ''} ORDER BY h.score DESC, h.id LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`,
            where.params,
        )], this.#readOptions(context)).catch(error => {
            if (isSearchSyntaxError(error)) throw new CmsError('CMS_VALIDATION', 'That search could not be read.');
            throw error;
        });
        return result.results[0]!.rows.map(row => this.#public(row[0] as Document, context.principal));
    }

    async revisions(id: string, context: OperationContext, options: { limit?: number } = {}): Promise<RevisionShape[]> {
        const { editor, since } = await this.#historyOf(id, context);
        // Each row is a whole snapshot: read in pages that fit the result budget.
        const rows = await readPaged(this.#host.db, (size, at) => ({
            rql: 'SELECT revision, at, actor, data FROM cms_revisions WHERE resource = $resource AND record_id = $key AND at >= $since ORDER BY revision DESC LIMIT $limit OFFSET $offset',
            params: { $resource: this.resource.id, $key: id, $since: since, $limit: size, $offset: at },
        }), options.limit ?? 50, 0, this.#readOptions(context));
        return rows.map(([revision, at, actor, data]) => this.#historyRow(revision, at, actor, data, editor, context.principal))
            .filter((row): row is RevisionShape => row !== null);
    }

    /**
     * A record's history is editorial: earlier revisions hold drafts and passwords the
     * published record does not show. Those who may change the record read all of it. Holders
     * of the resource's read permission, who read its drafts anyway, read the history of an
     * open record, without passwords or snapshots that were protected or members-only, as
     * export and the API treat them. Answers whether the principal may change the record, and
     * when the record was created: an ID created again after a delete starts a new history, so
     * rows of the deleted record its cleanup job has not removed yet are not its own.
     */
    async #historyOf(id: string, context: OperationContext): Promise<{ editor: boolean; since: number }> {
        const record = await this.get(id, context);
        if (!record) throw new CmsError('CMS_NOT_FOUND', 'Record not found.');
        const since = record.createdAt;
        if (this.canUpdate(record, context.principal)) return { editor: true, since };
        if (!hasPermission(context.principal, `${this.resource.id}:read`) || isLockedRecord(record)) {
            throw new CmsError('CMS_FORBIDDEN', 'Only editors read this record\'s revisions.');
        }
        return { editor: false, since };
    }

    #historyRow(revision: unknown, at: unknown, actor: unknown, data: unknown, editor: boolean, principal: Principal): RevisionShape | null {
        const snapshot = JSON.parse(data as string) as RecordShape;
        if (!editor && isLockedRecord(snapshot)) return null;
        const shaped = this.#redact(snapshot, principal);
        return { revision: Number(revision), at: Number(at), actor: actor as string | null, data: editor || !('password' in shaped) ? shaped : Object.freeze({ ...shaped, password: null }) as RecordShape };
    }

    /** One revision's snapshot of a record the principal may change, or null. */
    async revision(id: string, revision: number, context: OperationContext): Promise<RevisionShape | null> {
        const { editor, since } = await this.#historyOf(id, context);
        if (!Number.isSafeInteger(revision) || revision < 1) return null;
        const result = await this.#host.db.read([{
            rql: 'SELECT revision, at, actor, data FROM cms_revisions WHERE resource = $resource AND record_id = $key AND revision = $revision AND at >= $since',
            params: { $resource: this.resource.id, $key: id, $revision: revision, $since: since },
        }], this.#readOptions(context));
        const row = result.results[0]!.rows[0];
        return row ? this.#historyRow(row[0], row[1], row[2], row[3], editor, context.principal) : null;
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
    /** The record as this principal may read it outside the site's gate: whole for those who may update it, else the reader's view (`lockedView`). */
    readerView(record: RecordShape, principal: Principal): RecordShape {
        return this.canUpdate(record, principal) ? record : lockedView(record, this.resource.fields);
    }

    canUpdate(record: RecordShape, principal: Principal): boolean {
        return this.#inScope(this.resource.access.update, record, principal);
    }

    /** Whether the principal may read this record: the read rule, evaluated on the record itself. */
    canRead(record: RecordShape, principal: Principal): boolean {
        return this.#inScope(this.resource.access.read, record, principal);
    }

    /**
     * Co-owners (an entry's authors): a new record starts with its creator. Only people the update
     * rule allows on every record (who edit others' entries) choose others; an empty list reads as
     * the creator alone.
     */
    #checkCoOwners(action: 'create' | 'update', draft: { [field: string]: unknown }, previous: RecordShape | null, principal: Principal, errors: { [field: string]: string }): void {
        const co = this.resource.coOwners;
        if (!co || principal.kind !== 'user' || errors[co]) return;
        const given = draft[co] as readonly string[] | null | undefined;
        if (action === 'create' && !given?.length) { draft[co] = [principal.id]; return; }
        if (given === undefined || evaluateRule(this.resource.access.update, principal) === 'allow') return;
        const fallback = previous ? (previous.owner ? [previous.owner] : []) : [principal.id];
        const list = (value: unknown) => JSON.stringify(Array.isArray(value) && value.length ? value : fallback);
        if (list(given) !== list(previous?.[co])) errors[co] = 'can be changed by people who edit others\' entries.';
    }

    /** Whether the user owns the record: its creator, or one of its co-owners (an entry's authors). */
    #owns(record: RecordShape, user: string): boolean {
        if (record.owner === user) return true;
        const co = this.resource.coOwners;
        return co !== undefined && Array.isArray(record[co]) && (record[co] as unknown[]).includes(user);
    }

    #inScope(rule: AccessRule, record: RecordShape, principal: Principal): boolean {
        const scope = ruleScope(rule, principal);
        if (scope === 'allow' || scope === 'deny') return scope === 'allow';
        if (scope.owner && principal.kind === 'user' && this.#owns(record, principal.id)) return true;
        return scope.where.some(rule => Object.entries(rule).every(([name, value]) => record[name] === value));
    }

    /**
     * The records a record-link field leads to, level by level, in one request: RomeQL's
     * record projections (`parent.*`, `parent.*.parent.*`, …) fetch each record's chain up to
     * `depth` links deep. Each chain is nearest first and stops at the first link that is
     * missing or that the principal may not read.
     */
    async ancestors(ids: readonly string[], field: string, context: OperationContext, depth = 8): Promise<Map<string, RecordShape[]>> {
        await this.#authorize('read', context.principal);
        const declaration = this.resource.fields[field];
        if (!declaration || declaration.kind !== 'reference' || !FIELD_NAME.test(field)) throw new CmsError('CMS_VALIDATION', `${field} is not a reference field.`);
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && KEY.test(id)))].slice(0, 200);
        const chains = new Map<string, RecordShape[]>();
        if (!wanted.length) return chains;
        const params: { [key: string]: Value } = {};
        const list = wanted.map((id, index) => { params[`$k${index}`] = id; return `type::record('${this.resource.storage}', $k${index})`; }).join(', ');
        const levels = Array.from({ length: Math.min(Math.max(depth, 1), 8) }, (_, index) => Array.from({ length: index + 1 }, () => `${field}.*`).join('.'));
        const result = await this.#host.db.read([{
            rql: `SELECT id, ${levels.map((path, index) => `${path} AS l${index}`).join(', ')} FROM ${this.resource.storage} WHERE id IN (${list}) LIMIT ${wanted.length}`, params,
        }], this.#readOptions(context));
        for (const row of result.results[0]!.rows) {
            const chain: RecordShape[] = [];
            for (let index = 1; index < row.length; index++) {
                const document = row[index];
                if (!document || typeof document !== 'object' || document instanceof RecordId || !(document as Document).id) break;
                const record = this.#public(document as Document, context.principal);
                if (!this.canRead(record, context.principal)) break;
                chain.push(record);
            }
            chains.set(String((row[0] as RecordId).key), chain);
        }
        return chains;
    }

    async create(input: { readonly [field: string]: unknown }, context: OperationContext & { readonly id?: string }): Promise<RecordShape> {
        const access = await this.#authorize('create', context.principal);
        // Only an owner rule lets a user create; a record condition cannot be checked before the record exists.
        if (access !== 'allow' && !(access.owner && context.principal.kind === 'user')) {
            throw new CmsError(context.principal.kind === 'user' ? 'CMS_FORBIDDEN' : 'CMS_UNAUTHENTICATED', `Not allowed to create ${this.resource.id}.`);
        }
        const key = context.id ?? uuidv7();
        checkKey(key);
        const draft = await this.#prepareDraft('create', null, input, null, context);
        const now = this.#host.now();
        const op = uuidv7();
        const owner = this.resource.ownership && context.principal.kind === 'user' ? context.principal.id : null;
        const record = this.#shape(key, 1, now, now, owner, draft);
        const document: { [field: string]: Value } = { id: new RecordId(this.resource.storage, key), _rev: 1, _op: op, _createdAt: now, _updatedAt: now, _owner: owner };
        for (const [name, value] of Object.entries(draft)) if (value !== undefined) document[name] = this.#store(name, this.resource.fields[name]!, value);
        for (const [path, text] of this.#searchText(draft)) document[path] = text;
        const statements: Statement[] = [{ rql: `INSERT INTO ${this.resource.storage} DOCUMENT $document`, params: { $document: document } }];
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $op)`;
        statements.push(...this.#sideEffects(guard, op, key, 1, 'create', record, actor(context.principal), now));
        await this.#write(statements, op, context, error => {
            if (error.code === 'RDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'A record with the same unique value already exists.', { cause: error });
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
            if (error.code === 'RDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'A record with the same unique value already exists.', { cause: error });
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
        const op = uuidv7();
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
        const shared = await this.#sharedStatement(id, previous, draft, guard, { $key: id, $op: op, $now: now }, context);
        if (shared) {
            statements.push(shared);
            // The other translations' own rows follow from the outbox, queued only when this commits.
            const event: SharedFieldsEvent = { eventId: `shared:${op}`, topic: 'resource.shared', at: now, resource: this.resource.id, id, group: translationGroupOf(previous), op, actor: actor(context.principal) };
            statements.push(bound(
                `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) SELECT $sharedId, $sharedTopic, $sharedPayload, $now, $now, 0, 0 WHERE ${guard}`,
                { $key: id, $op: op, $now: now, $sharedId: event.eventId, $sharedTopic: event.topic, $sharedPayload: JSON.stringify(event) },
            ));
        }
        statements.push(...this.#sideEffects(guard, op, id, revision, 'update', record, actor(context.principal), now, {}, previous));
        // A published entry whose URL changes keeps answering at the old one. The audit row,
        // written only when the change commits, guards these relational statements.
        statements.push(...await this.#host.redirectStatements(this.resource, previous, record, { rql: 'EXISTS (SELECT 1 FROM cms_audit WHERE id = $rOp)', params: { $rOp: op } }, principalId(context.principal)));
        const result = await this.#write(statements, op, context);
        if (result.affected !== 1) throw new CmsError('CMS_CONFLICT', 'The record changed since it was read. Reload and try again.');
        return this.#redact(record, context.principal);
    }

    /**
     * Fields that are the same in every language (`translatable: false`) and changed: one
     * statement gives them to every other translation of the entry, once the entry's own update
     * committed, with each translation's revision moved on (so an editor holding an older one
     * reloads) and the entry's operation ID. The principal must be able to update every
     * translation. The translations' revision, audit, search and outbox rows follow from an outbox
     * job (`sharedSideEffects`), so a site with many languages still fits one request.
     */
    async #sharedStatement(id: string, previous: RecordShape, draft: Draft, guard: string, params: { [key: string]: Value }, context: OperationContext): Promise<Statement | null> {
        if (!this.resource.fields.translationGroup) return null;
        const changed = Object.entries(this.resource.fields).filter(([name, declaration]) => declaration.translatable === false && draft[name] !== undefined
            && JSON.stringify(draft[name] ?? null) !== JSON.stringify(previous[name] ?? null)).map(([name]) => name);
        if (!changed.length) return null;
        const group = translationGroupOf(previous);
        const members = await this.#host.db.read([{
            rql: `SELECT record::id(id) FROM ${this.resource.storage} WHERE ${this.#membersOf()} ORDER BY record::id(id) LIMIT ${SHARED_MEMBERS + 1}`,
            params: { $group: group, $key: id },
        }], this.#readOptions(context));
        const others = members.results[0]!.rows.map(row => row[0] as string);
        if (!others.length) return null;
        // The check, the update and its side effects all cover the same members: every one of them.
        if (others.length > SHARED_MEMBERS) throw new CmsError('CMS_LIMIT', `An entry with more than ${SHARED_MEMBERS} translations cannot change a field that is the same in every language.`);
        if ((await this.updatable(others, context)).size < others.length) {
            const labels = changed.map(name => this.resource.fields[name]!.label ?? name).join(', ');
            throw new CmsError('CMS_FORBIDDEN', `${labels} is the same in every language, and you cannot edit every translation.`, { fields: Object.fromEntries(changed.map(name => [name, 'is the same in every language.'])) });
        }
        const shared: Draft = Object.fromEntries(changed.map(name => [name, draft[name]]));
        const values: { [key: string]: Value } = { ...params, $group: group };
        const assignments = changed.map((name, index) => {
            values[`$s${index}`] = this.#store(name, this.resource.fields[name]!, draft[name]);
            return `${quote(name)} = $s${index}`;
        });
        for (const [index, [path, text]] of this.#searchText(shared).entries()) {
            values[`$st${index}`] = text;
            assignments.push(`${quote(path)} = $st${index}`);
        }
        // Only the members checked above: a translation started since then keeps the value it copied.
        const checked = others.map((other, index) => { values[`$m${index}`] = other; return `type::record('${this.resource.storage}', $m${index})`; }).join(', ');
        return {
            rql: `UPDATE ${this.resource.storage} SET ${[...assignments, '"_rev" = "_rev" + 1', '"_op" = $op', '"_updatedAt" = $now'].join(', ')} WHERE id IN (${checked}) AND ${this.#membersOf()} AND ${guard}`,
            params: values,
        };
    }

    /** The entry's other translations, by `$group` and the entry's own `$key`. */
    #membersOf(): string {
        return `("translationGroup" = $group OR id = type::record('${this.resource.storage}', $group)) AND record::id(id) != $key`;
    }

    /**
     * The revision, audit, search and outbox rows of the translations a shared-field update
     * changed (the `resource.shared` outbox job). Each translation still holding that update is
     * read on its own, so a read stays inside RomeDB's result budget, and its rows are written
     * under an operation ID derived from the update's, guarded on the translation still holding
     * the update (its `_op` and revision): a translation saved again since wrote its own rows,
     * and rows a retry finds written are skipped. Writes are batched to fit a request; a failure
     * throws, and the outbox retries.
     */
    async sharedSideEffects(event: SharedFieldsEvent, options: { signal?: AbortSignal } = {}): Promise<void> {
        const call = { ...(options.signal ? { signal: options.signal } : {}), workLimits: this.#host.readLimits };
        const listed = await this.#host.db.read([{
            rql: `SELECT record::id(id) FROM ${this.resource.storage} WHERE ${this.#membersOf()} AND "_op" = $op LIMIT ${SHARED_MEMBERS}`,
            params: { $group: event.group, $key: event.id, $op: event.op },
        }], call);
        const ids = listed.results[0]!.rows.map(row => row[0] as string);
        if (!ids.length) return;
        const ops = new Map(await Promise.all(ids.map(async id => [id, await sharedOp(event.op, id)] as const)));
        const params: { [key: string]: Value } = {};
        const list = ids.map((id, index) => { params[`$a${index}`] = ops.get(id)!; return `$a${index}`; }).join(', ');
        const written = await this.#host.db.read([{ rql: `SELECT id FROM cms_audit WHERE id IN (${list})`, params }], call);
        const done = new Set(written.results[0]!.rows.map(row => row[0] as string));
        const limit = await this.#host.db.maxRequestBytes() - REQUEST_MARGIN;
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $sharedOp AND "_rev" = $sharedRev)`;
        let batch: Statement[] = [];
        let bytes = 0;
        const flush = async () => {
            if (!batch.length) return;
            await this.#host.db.write(batch, { kind: 'cms.resource.shared', ...(options.signal ? { signal: options.signal } : {}), workLimits: this.#host.writeLimits });
            batch = []; bytes = 0;
            this.#host.outboxWritten();
        };
        for (const id of ids) {
            const op = ops.get(id)!;
            if (done.has(op)) continue;
            const row = await this.#host.db.read([{
                rql: `SELECT * FROM ${this.resource.storage} WHERE id = type::record('${this.resource.storage}', $key) AND "_op" = $op`,
                params: { $key: id, $op: event.op },
            }], call);
            const document = row.results[0]!.rows[0]?.[0] as Document | undefined;
            if (!document) continue;
            const member = this.#shapeOf(document);
            const group = this.#sideEffects(guard, op, member.id, member.rev, 'update', member, event.actor, event.at, { $sharedOp: event.op, $sharedRev: member.rev }, member);
            const size = statementBytes(group);
            if (batch.length && (batch.length + group.length > MAX_STATEMENTS || bytes + size > limit)) await flush();
            batch.push(...group); bytes += size;
        }
        await flush();
    }

    /** The IDs among these the principal may update. */
    async updatable(ids: readonly string[], context: OperationContext): Promise<Set<string>> {
        let access: Access;
        try { access = await this.#authorize('update', context.principal); } catch (error) { if (error instanceof CmsError) return new Set(); throw error; }
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && KEY.test(id)))].slice(0, 200);
        if (!wanted.length) return new Set();
        const params: { [key: string]: Value } = {};
        const list = wanted.map((key, index) => { params[`$k${index}`] = key; return `type::record('${this.resource.storage}', $k${index})`; }).join(', ');
        const { rql, params: bound } = this.#conditions(access, context.principal, [`id IN (${list})`], params);
        const result = await this.#host.db.read([{ rql: `SELECT record::id(id) FROM ${this.resource.storage} WHERE ${rql} LIMIT ${wanted.length}`, params: bound }], this.#readOptions(context));
        return new Set(result.results[0]!.rows.map(row => row[0] as string));
    }

    async delete(id: string, context: OperationContext & { readonly expectedRevision: number }): Promise<void> {
        const access = await this.#authorize('delete', context.principal);
        checkKey(id);
        if (!Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 1) throw new CmsError('CMS_VALIDATION', 'expectedRevision must be a positive integer.');
        const now = this.#host.now();
        const op = uuidv7();
        const condition = this.#conditions(access, context.principal, [`id = type::record('${this.resource.storage}', $key)`, '"_rev" = $expected'], { $key: id, $expected: context.expectedRevision });
        // Guards run before the delete, against the same snapshot.
        const guard = `EXISTS (SELECT 1 FROM ${this.resource.storage} WHERE ${condition.rql})`;
        const previous = this.resource.fields.status ? await this.#current(id, access, context) : null;
        const statements = this.#sideEffects(guard, op, id, context.expectedRevision, 'delete', null, actor(context.principal), now, condition.params, previous);
        statements.push(bound(`DELETE FROM ${this.resource.storage} WHERE ${condition.rql}`, condition.params));
        const deleted = await this.#write(statements, op, context, undefined, statements.length - 1);
        if (deleted.affected !== 1) throw new CmsError('CMS_CONFLICT', 'The record changed or was deleted since it was read.');
    }

    async #authorize(action: ResourceAction, principal: Principal): Promise<Access> {
        await this.#host.assertActive(this.resource, { fresh: action !== 'read' });
        const outcome = ruleScope(this.resource.access[action], principal);
        if (outcome === 'deny') throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', `Not allowed to ${action} ${this.resource.id}.`);
        return outcome;
    }

    /** Join conditions with the access scope: the principal's own records or those matching a rule's fields. */
    /** One record by key, as a RomeQL record source (`FROM type::record(...)`: an ID lookup), under the principal's read conditions. */
    #one(id: string, access: Access, principal: Principal): Statement {
        const { rql, params } = this.#conditions(access, principal, [], { $key: id });
        return { rql: `SELECT * FROM type::record('${this.resource.storage}', $key)${rql ? ` WHERE ${rql}` : ''} LIMIT 1`, params };
    }

    #conditions(access: Access, principal: Principal, conditions: string[], params: { [key: string]: Value }, prefix = ''): { rql: string; params: { [key: string]: Value } } {
        if (access !== 'allow') {
            const scope: string[] = [];
            params = { ...params };
            if (access.owner && principal.kind === 'user') {
                const co = this.resource.coOwners;
                scope.push(co ? `(${prefix}"_owner" = $owner OR array::contains(${prefix}${quote(co)}, $owner))` : `${prefix}"_owner" = $owner`);
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
            if (declaration.multiple) {
                const values = condition !== null && typeof condition === 'object' && 'contains' in condition ? [condition.contains]
                    : condition !== null && typeof condition === 'object' && 'containsAny' in condition ? [...condition.containsAny] : undefined;
                if (!values || !values.length || values.length > 50 || !declaration.index) throw new CmsError('CMS_VALIDATION', `Filter ${name} with contains or containsAny (1-50 values) on an indexed multiple field.`);
                const item: FieldDeclaration = { ...declaration, multiple: false, required: false, nullable: false };
                conditions.push(values.map(value => {
                    check(value, item);
                    return `array::contains(${column}, ${parameter(this.#store(name, item, value))})`;
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
                const values = condition.in.filter(value => value !== null);
                const listed = values.length ? `${column} IN (${values.map(value => { check(value); return parameter(this.#store(name, declaration, value)); }).join(', ')})` : '';
                const unset = values.length < condition.in.length ? `${column} IS NULL` : '';
                conditions.push(listed && unset ? `(${unset} OR ${listed})` : listed || unset);
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
            // An entry's authors own it too, so an author's archive lists what they co-wrote.
            const owner = parameter(filter.owner);
            const co = this.resource.coOwners;
            conditions.push(co ? `(${prefix}"_owner" = ${owner} OR array::contains(${prefix}${quote(co)}, ${owner}))` : `${prefix}"_owner" = ${owner}`);
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
        const result = await this.#host.db.read([this.#one(id, access, context.principal)], this.#readOptions(context));
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
            // A filter's own field errors (a CmsError it threw) stay with the fields they name.
            const fields = isCmsError(cause) ? cause.fields : undefined;
            throw new CmsError('CMS_VALIDATION', cause instanceof Error ? cause.message : 'A plugin rejected the change.', { cause: error, ...(fields ? { fields } : {}) });
        }
        // Filters can change values; validate the result again.
        const final = filtered === draft ? draft : this.#validate(action, filtered, previous, context.principal);
        this.#checkGroup(final, previous, context);
        await this.#checkReferences(final, id);
        await this.#checkTemplate(final, previous);
        await this.#checkNotes(final, previous);
        return this.#uniqueSlugs(await this.#withLocale(action, final), id, previous, context);
    }

    /**
     * Joining a translation group goes through `translateEntry` alone: a save may keep the
     * entry's group or leave it (null), never name another one, which would make the entry a
     * translation of somebody else's.
     */
    #checkGroup(draft: Draft, previous: RecordShape | null, context: OperationContext): void {
        const group = draft.translationGroup;
        if (group === undefined || group === null) return;
        const current = previous && typeof previous.translationGroup === 'string' ? previous.translationGroup : null;
        if (group === current) return;
        if ((context as { readonly [JOIN_GROUP]?: string })[JOIN_GROUP] === group) return;
        throw new CmsError('CMS_VALIDATION', 'Start a translation from the entry it translates.', { fields: { translationGroup: 'is set when a translation starts.' } });
    }

    /** A new content entry belongs to a language: the site's default unless it names one. */
    async #withLocale(action: 'create' | 'update', draft: Draft): Promise<Draft> {
        if (action !== 'create' || !this.resource.id.startsWith('cms/') || !this.resource.fields.locale || !this.resource.fields.translationGroup || typeof draft.locale === 'string') return draft;
        return Object.freeze({ ...draft, locale: (await this.#host.languages()).default });
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
                const found = await this.#host.db.read([{ rql: `SELECT count(*) FROM cms_files WHERE status = 'ready' AND ${LIBRARY_KEYS} AND id IN (${list})`, params: Object.fromEntries(unique.map((file, index) => [`$m${index}`, file])) }]);
                if (Number(found.results[0]!.rows[0]![0] as bigint) !== unique.length) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} names a missing file.`, { fields: { [name]: 'names a missing file.' } });
            }
            if (declaration.kind === 'reference' && declaration.target === this.resource.id) {
                // Walk up from the new parent; reaching this record would make a cycle.
                let current: string | null = value as string;
                for (let depth = 0; current; depth++) {
                    if (current === id) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} cannot be this record or one below it.`, { fields: { [name]: 'would make a cycle.' } });
                    if (depth >= 32) throw new CmsError('CMS_LIMIT', 'Records nest at most 32 levels deep.');
                    const row: Value | undefined = (await this.#host.db.read([{ rql: `SELECT ${quote(name)} FROM type::record('${this.resource.storage}', $key)`, params: { $key: current } }])).results[0]!.rows[0]?.[0];
                    if (row === undefined) throw new CmsError('CMS_VALIDATION', `${declaration.label ?? name} names a missing record.`, { fields: { [name]: 'names a missing record.' } });
                    current = row instanceof RecordId ? String(row.key) : null;
                }
            }
        }
    }

    /**
     * With "Open notes hold publishing" on (Settings → Writing), an entry that is not live yet is
     * not published or scheduled while it has open notes, whoever writes it: the editor, the API,
     * a plugin or an automation. An entry already live keeps being updated, and a scheduled one
     * is published when due.
     */
    async #checkNotes(draft: Draft, previous: RecordShape | null): Promise<void> {
        const status = draft.status;
        if (this.resource.owner !== 'cms' || !previous || (status !== 'published' && status !== 'scheduled')) return;
        if (previous.status === 'published' || previous.status === 'scheduled') return;
        if (!(await this.#host.settings.get('writing.requireResolvedNotes'))) return;
        const open = (await this.#host.notes.counts(this.resource.id, [previous.id])).get(previous.id) ?? 0;
        if (open) throw new CmsError('CMS_VALIDATION', open === 1 ? 'Resolve the open note before publishing.' : `Resolve the ${open} open notes before publishing.`, { fields: { status: 'Open notes hold publishing.' } });
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

    /**
     * Unique slug fields get the first free `-2`, `-3`, … suffix, so a duplicate title does not fail the write.
     * A slug unique by other fields (its language) is free when those differ; changing them checks the slug again.
     */
    async #uniqueSlugs(draft: Draft, id: string | null, previous: RecordShape | null, context: OperationContext): Promise<Draft> {
        let adjusted: { [field: string]: unknown } | undefined;
        for (const [name, declaration] of Object.entries(this.resource.fields)) {
            const scope = declaration.uniqueBy ?? [];
            const value = draft[name] ?? (scope.some(other => draft[other] !== undefined) ? previous?.[name] : undefined);
            if (!declaration.slugFrom || !declaration.unique || typeof value !== 'string' || !value) continue;
            const params: { [key: string]: Value } = { $slug: value, $prefix: `${value}-%`, ...(id ? { $key: id } : {}) };
            const within = scope.map((other, index) => {
                const current = draft[other] !== undefined ? draft[other] : previous?.[other];
                if (current === null || current === undefined) return ` AND ${quote(other)} IS NULL`;
                params[`$u${index}`] = current as Value;
                return ` AND ${quote(other)} = $u${index}`;
            }).join('');
            const result = await this.#host.db.read([{
                rql: `SELECT ${quote(name)} FROM ${this.resource.storage} WHERE (${quote(name)} = $slug OR ${quote(name)} LIKE $prefix)${within}${id ? ' AND record::id(id) != $key' : ''} LIMIT 1000`, params,
            }], this.#readOptions(context));
            const taken = new Set(result.results[0]!.rows.map(row => row[0] as string));
            // Entries at the site root share one namespace, per language, with routes and other root collections.
            const locale = draft.locale !== undefined ? draft.locale : previous?.locale;
            for (const slug of await this.#host.rootSlugConflicts(this.resource.id, value, typeof locale === 'string' ? locale : null)) taken.add(slug);
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
            const error = validateValue(name, declaration, value) ?? textFieldProblem(declaration, value, this.#host.blockTypes);
            if (error) { errors[name] = error; continue; }
            if ((declaration.kind === 'blocks' || declaration.kind === 'richtext') && !hasPermission(principal, PERMISSIONS.unfilteredHtml) && htmlBlocksChanged(value, previous?.[name])) {
                errors[name] = 'has a Custom HTML block, which only people allowed to post HTML can add or change.';
                continue;
            }
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
        this.#checkCoOwners(action, draft, previous, principal, errors);
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
        const names = new Map(flattenBlocks(layout).map(block => [block._id, typeof block.data.name === 'string' ? block.data.name : '']));
        const top = new Set<string>();
        for (const key of hidden) {
            if (key.includes('/')) continue;
            const name = names.get(key);
            if (name && Object.hasOwn(this.resource.fields, name)) top.add(name);
        }
        for (const [name, declaration] of Object.entries(this.resource.fields)) if (declaration.kind === 'rows' && draft[name] !== undefined && !top.has(name)) draft[name] = cleared[name] ?? draft[name];
        return top;
    }

    #sideEffects(guard: string, op: string, key: string, revision: number, action: 'create' | 'update' | 'delete', record: RecordShape | null, who: WriteActor, now: number, extra: { [key: string]: Value } = {}, previous: RecordShape | null = null): Statement[] {
        const params = { ...extra, $key: key, $op: op, $resource: this.resource.id, $revision: revision, $actor: who.id, $at: now };
        const statements: Statement[] = [];
        if (this.resource.revisions && record) {
            statements.push(bound(
                // A row left by a deleted entry of the same ID (its cleanup job not run yet) gives way.
                `INSERT INTO cms_revisions (id, resource, record_id, revision, data, actor, at) SELECT $revisionId, $resource, $key, $revision, $data, $actor, $at WHERE ${guard}
                    ON CONFLICT (id) DO UPDATE SET data = excluded.data, actor = excluded.actor, at = excluded.at`,
                { ...params, $revisionId: `${this.resource.id}:${key}:${revision}`, $data: JSON.stringify(record) },
            ));
        }
        statements.push(bound(
            `INSERT INTO cms_audit (id, actor, action, resource, record_id, revision, at) SELECT $op, $actor, $action, $resource, $key, $revision, $at WHERE ${guard}`,
            { ...params, $action: action },
        ));
        // A deleted record's revisions, drafts, notes and preview links go in an outbox job
        // (`entryDeleted` in the host), a page at a time: an entry saved a thousand times still deletes.
        // The site's search index, guarded by the audit row above.
        statements.push(...this.#host.siteSearch.statements(this.resource, key, op, record && this.canRead(record, ANONYMOUS) ? record : null));
        const event: ResourceEvent = {
            eventId: op, topic: action === 'create' ? 'resource.created' : action === 'update' ? 'resource.updated' : 'resource.deleted',
            // Webhooks, plugins and automations get the reader's view: a locked entry's password and content stay here.
            resource: this.resource.id, id: key, revision, actor: who, at: now, record: record ? lockedView(record, this.resource.fields) : null,
            ...(this.resource.fields.status ? { previousStatus: typeof previous?.status === 'string' ? previous.status : null } : {}),
        };
        statements.push(bound(
            `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) SELECT $op, $topic, $payload, $at, $at, 0, 0 WHERE ${guard}`,
            { ...params, $topic: event.topic, $payload: JSON.stringify(event) },
        ));
        return statements;
    }

    async #write(statements: Statement[], op: string, context: OperationContext, onRolledBack?: (error: ClientError) => void, statement = 0, kind = 'cms.resource.write'): Promise<{ affected: number; sequence: number }> {
        try {
            const result = await this.#host.db.write(statements, { requestId: op, kind, ...(context.signal ? { signal: context.signal } : {}), workLimits: this.#host.writeLimits });
            this.#host.outboxWritten();
            return { affected: Number(result.results[statement]!.affected), sequence: result.sequence };
        } catch (error) {
            if (error instanceof RequestTooLargeError) throw new CmsError('CMS_LIMIT', 'This entry is too large to save. Shorten it, or split it into several entries.', { cause: error });
            if (error instanceof UncertainWriteError) throw new CmsError('CMS_UNCERTAIN', 'The change was sent but not confirmed. It will be completed or reported shortly.', { requestId: error.requestId, cause: error });
            if (error instanceof ClientError && error.outcome === 'rolled-back') {
                if (error.code === 'RDB_WRITE_CONFLICT') throw new CmsError('CMS_CONFLICT', 'The record changed since it was read. Reload and try again.', { cause: error });
                // Over the write's work limits (rows changed, rows read, steps): a plain limit, not a 500.
                if (error.code === 'RDB_LIMIT') throw new CmsError('CMS_LIMIT', 'This change is too large for one write. Make it in smaller steps.', { cause: error });
                onRolledBack?.(error);
                if (error.code === 'RDB_VALIDATION' || error.code === 'RDB_CONSTRAINT') throw new CmsError('CMS_VALIDATION', 'The database rejected the values.', { cause: error });
            }
            throw error;
        }
    }

    #readOptions(context: OperationContext) {
        return { ...(context.signal ? { signal: context.signal } : {}), workLimits: this.#host.readLimits };
    }

    #store(name: string, declaration: FieldDeclaration, value: unknown): Value {
        if (value === null) return null;
        // A multiple field stores its items as the kind stores one.
        if (declaration.multiple) return (value as unknown[]).map(item => this.#store(name, { ...declaration, multiple: false }, item));
        switch (declaration.kind) {
            case 'bigint': return BigInt(value as string | bigint);
            case 'number': return new Float64(value as number);
            case 'reference': return new RecordId(this.#host.resourceById(declaration.target!).storage, value as string);
            case 'vector': return Vector.float32(value as number[]);
            case 'json': case 'blocks': case 'richtext': case 'rows': return storedJson(value);
            default: return value as Value;
        }
    }

    /** Plain text of the draft's searchable rich text, blocks, rows and multiple fields, at their search paths. */
    #searchText(draft: Draft): [string, string | null][] {
        const plain = (declaration: FieldDeclaration, value: unknown): string => declaration.multiple && Array.isArray(value) ? value.map(item => plain({ ...declaration, multiple: false }, item)).filter(Boolean).join('\n')
            : declaration.kind === 'blocks' ? blocksPlain(value as Block[], this.#host.blockTypes, doc => richTextPlain(doc))
            : declaration.kind === 'rows' ? rowsPlain(declaration, value)
            : declaration.kind === 'richtext' ? richTextPlain(value as RichTextDoc) : typeof value === 'string' ? value : '';
        return Object.entries(this.resource.fields)
            .filter(([name, declaration]) => searchedAsText(declaration) && draft[name] !== undefined)
            .map(([name, declaration]) => [searchTextPath(name), draft[name] === null ? null : plain(declaration, draft[name])]);
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
function storedJson(value: unknown): Value {
    if (typeof value === 'number') return Number.isInteger(value) ? value : new Float64(value);
    if (Array.isArray(value)) return value.map(storedJson);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, storedJson(entry)]));
    return value as Value;
}

function toJson(value: Value): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Float64) return value.value;
    if (value instanceof RecordId) return `${value.table}:${String(value.key)}`;
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

/** Translations one shared-field update reaches. */
const SHARED_MEMBERS = 100;
/** Room left in a request for its envelope (request ID, sequences, work limits). */
const REQUEST_MARGIN = 2048;
