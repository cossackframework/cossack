/**
 * Comments on entries, with moderation: pending, approved, spam and trash. The host checks
 * the entry and the Discussion settings before posting; this class keeps the rows.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { containsPattern, inList } from './users';
import { checkComment, COMMENT_STATUSES, type CommentRow, type CommentShape, type CommentStatus } from '../comments';
import { defineAction } from '@cossackframework/core/hooks';

/** A deleted collection, queued in the batch that drops it, so its comments go in a retried job. */
export interface CollectionDeletedEvent {
    readonly eventId: string;
    readonly topic: 'collection.deleted';
    readonly at: number;
    readonly resource: string;
}

/** Runs the deleted collection's cleanup from the outbox. The host handles it; plugins cannot hook it. */
export const collectionDeleted = defineAction<CollectionDeletedEvent>('cms.collection.deleted', { version: 1, timeoutMs: 60_000 });

/** The outbox row that queues `collectionDeleted`, for the batch that drops the collection. */
export function collectionDeletedStatement(resource: string, eventId: string, at: number): Statement {
    const event: CollectionDeletedEvent = { eventId, topic: 'collection.deleted', at, resource };
    return {
        rql: 'INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($eventId, $topic, $payload, $at, $at, 0, 0)',
        params: { $eventId: eventId, $topic: event.topic, $payload: JSON.stringify(event), $at: at },
    };
}

export interface CommentListOptions {
    readonly status?: CommentStatus;
    readonly resource?: string;
    readonly recordId?: string;
    readonly search?: string;
    readonly offset?: number;
    readonly limit?: number;
}

const WRITE = { kind: 'cms.comments', retryConflicts: 5 } as const;
const COLUMNS = 'id, resource, record_id, parent_id, user_id, author_name, author_email, author_url, content, status, created_at, updated_at';
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export class CmsComments {
    readonly #db: RomeDB;
    readonly #now: () => number;

    /** Called after a committed change with the entries whose comments changed, for the host to purge their pages. */
    readonly #changed: ((entries: readonly { resource: string; recordId: string }[]) => void | Promise<void>) | undefined;

    constructor(db: RomeDB, options: { now?: () => number; changed?: (entries: readonly { resource: string; recordId: string }[]) => void | Promise<void> } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
        this.#changed = options.changed;
    }

    async get(id: string): Promise<CommentShape | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_comments WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? commentOf(row) : null;
    }

    /** Comments for the moderation screen, newest first. */
    async list(options: CommentListOptions = {}): Promise<{ items: CommentShape[]; total: number }> {
        const { where, params } = conditions(options);
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const offset = Math.min(Math.max(options.offset ?? 0, 0), 10_000);
        const result = await this.#db.read([
            { rql: `SELECT ${COLUMNS} FROM cms_comments${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, ...(Object.keys(params).length ? { params } : {}) },
            { rql: `SELECT count(*) FROM cms_comments${where}`, ...(Object.keys(params).length ? { params } : {}) },
        ]);
        return { items: result.results[0]!.rows.map(commentOf), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /** How many comments have each status. */
    async counts(): Promise<{ [K in CommentStatus]: number }> {
        const result = await this.#db.read(COMMENT_STATUSES.map(status => ({ rql: 'SELECT count(*) FROM cms_comments WHERE status = $status', params: { $status: status } })));
        return Object.fromEntries(COMMENT_STATUSES.map((status, index) => [status, Number(result.results[index]!.rows[0]![0] as bigint)])) as { [K in CommentStatus]: number };
    }

    /** An entry's comments with one status, oldest first, at most 500. */
    async forEntry(resource: string, recordId: string, status: CommentStatus = 'approved'): Promise<CommentShape[]> {
        const result = await this.#db.read([{
            rql: `SELECT ${COLUMNS} FROM cms_comments WHERE resource = $resource AND record_id = $record AND status = $status ORDER BY created_at, id LIMIT 500`,
            params: { $resource: resource, $record: recordId, $status: status },
        }]);
        return result.results[0]!.rows.map(commentOf);
    }

    /** Approved comment counts of entries, for archive lists. */
    async approvedCounts(resource: string, recordIds: readonly string[]): Promise<Map<string, number>> {
        const ids = [...new Set(recordIds.filter(id => ID.test(id)))].slice(0, 100);
        if (!ids.length) return new Map();
        const list = inList('r', ids);
        const result = await this.#db.read([{
            rql: `SELECT record_id, count(*) FROM cms_comments WHERE resource = $resource AND status = 'approved' AND record_id IN ${list.rql} GROUP BY record_id`,
            params: { $resource: resource, ...list.params },
        }]);
        return new Map(result.results[0]!.rows.map(([id, count]) => [id as string, Number(count as bigint)]));
    }

    /** Whether the email has an approved comment, for "approve returning commenters". */
    async hasApproved(email: string): Promise<boolean> {
        if (!email) return false;
        const result = await this.#db.read([{ rql: "SELECT 1 FROM cms_comments WHERE author_email = $email AND status = 'approved' LIMIT 1", params: { $email: email.toLowerCase() } }]);
        return result.results[0]!.rows.length > 0;
    }

    /** The insert statement for a new comment, so callers can batch it. */
    /** The comment's row; with `guard` (an SQL condition, such as the entry still existing), only while it holds. */
    insert(row: Omit<CommentRow, 'createdAt' | 'updatedAt'>, guard?: { readonly rql: string; readonly params: { readonly [key: string]: Value } }): Statement {
        const now = this.#now();
        const values = '$id, $resource, $record, $parent, $user, $name, $email, $url, $content, $status, $ip, $agent, $now, $now';
        return {
            rql: `INSERT INTO cms_comments (id, resource, record_id, parent_id, user_id, author_name, author_email, author_url, content, status, ip_hash, user_agent, created_at, updated_at)
                ${guard ? `SELECT ${values} WHERE ${guard.rql}` : `VALUES (${values})`}`,
            params: {
                ...guard?.params,
                $id: row.id, $resource: row.resource, $record: row.recordId, $parent: row.parentId, $user: row.userId, $name: row.authorName, $email: row.authorEmail.toLowerCase(),
                $url: row.authorUrl, $content: row.content, $status: row.status, $ip: row.ipHash, $agent: row.userAgent, $now: now,
            },
        };
    }

    /** Add a comment; with `guard`, refused as `CMS_NOT_FOUND` when it no longer holds, such as for an entry just deleted. */
    async create(row: Omit<CommentRow, 'createdAt' | 'updatedAt'>, guard?: { readonly rql: string; readonly params: { readonly [key: string]: Value } }): Promise<CommentShape> {
        const result = await this.#db.write([this.insert(row, guard)], WRITE);
        if (result.results[0]!.affected === 0n) throw new CmsError('CMS_NOT_FOUND', 'The entry is gone.');
        if (row.status === 'approved') await this.#changed?.([{ resource: row.resource, recordId: row.recordId }]);
        return (await this.get(row.id))!;
    }

    /** Approve, unapprove, mark as spam or trash comments. */
    async setStatus(ids: readonly string[], status: CommentStatus): Promise<number> {
        if (!COMMENT_STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown comment status.');
        const wanted = [...new Set(ids.filter(id => ID.test(id)))].slice(0, 100);
        if (!wanted.length) return 0;
        const list = inList('c', wanted);
        const entries = this.#changed ? await this.#entriesOf(list) : [];
        const result = await this.#db.write([{ rql: `UPDATE cms_comments SET status = $status, updated_at = $now WHERE id IN ${list.rql}`, params: { $status: status, $now: this.#now(), ...list.params } }], WRITE);
        if (entries.length) await this.#changed?.(entries);
        return Number(result.results[0]!.affected);
    }

    /** Edit a comment's text or author. */
    async update(id: string, input: { content?: string; authorName?: string; authorEmail?: string; authorUrl?: string }): Promise<CommentShape> {
        const current = await this.get(id);
        if (!current) throw new CmsError('CMS_NOT_FOUND', 'Comment not found.');
        const next = checkComment({
            content: input.content ?? current.content, authorName: input.authorName ?? current.authorName,
            authorEmail: input.authorEmail ?? current.authorEmail, authorUrl: input.authorUrl ?? current.authorUrl,
        }, false);
        await this.#db.write([{
            rql: 'UPDATE cms_comments SET content = $content, author_name = $name, author_email = $email, author_url = $url, updated_at = $now WHERE id = $id',
            params: { $content: next.content, $name: next.authorName, $email: next.authorEmail.toLowerCase(), $url: next.authorUrl, $now: this.#now(), $id: id },
        }], WRITE);
        if (current.status === 'approved') await this.#changed?.([{ resource: current.resource, recordId: current.recordId }]);
        return (await this.get(id))!;
    }

    /** Delete comments permanently. Their replies move up to the deleted comment's parent. */
    async delete(ids: readonly string[]): Promise<void> {
        const comments = (await Promise.all([...new Set(ids)].slice(0, 100).map(id => this.get(id)))).filter((comment): comment is CommentShape => comment !== null);
        if (!comments.length) return;
        const statements: Statement[] = [];
        for (const comment of comments) {
            statements.push({ rql: 'UPDATE cms_comments SET parent_id = $parent WHERE parent_id = $id', params: { $parent: comment.parentId, $id: comment.id } });
            statements.push({ rql: 'DELETE FROM cms_comments WHERE id = $id', params: { $id: comment.id } });
        }
        for (let index = 0; index < statements.length; index += 30) await this.#db.write(statements.slice(index, index + 30), WRITE);
        await this.#changed?.(comments.filter(comment => comment.status === 'approved').map(comment => ({ resource: comment.resource, recordId: comment.recordId })));
    }

    /** The entries of these comments, for a purge. */
    async #entriesOf(list: { rql: string; params: { [name: string]: Value } }): Promise<{ resource: string; recordId: string }[]> {
        const result = await this.#db.read([{ rql: `SELECT DISTINCT resource, record_id FROM cms_comments WHERE id IN ${list.rql}`, params: list.params }]);
        return result.results[0]!.rows.map(([resource, recordId]) => ({ resource: resource as string, recordId: recordId as string }));
    }

    /** Delete an entry's comments, after the entry is deleted. */
    async deleteForEntry(resource: string, recordId: string): Promise<void> {
        await this.#deleteWhere('resource = $resource AND record_id = $record', { $resource: resource, $record: recordId });
    }

    /** Delete every comment on a resource's entries, after the resource (a collection) is deleted. */
    async deleteForResource(resource: string): Promise<void> {
        await this.#deleteWhere('resource = $resource', { $resource: resource });
    }

    /** Delete matching comments a thousand at a time, until none are left. */
    async #deleteWhere(where: string, params: { [key: string]: Value }): Promise<void> {
        for (;;) {
            const result = await this.#db.write([{ rql: `DELETE FROM cms_comments WHERE id IN (SELECT id FROM cms_comments WHERE ${where} LIMIT ${DELETE_BATCH})`, params }], WRITE);
            if (Number(result.results[0]!.affected) < DELETE_BATCH) return;
        }
    }
}

/** How many comments one delete removes. */
const DELETE_BATCH = 1000;

function conditions(options: CommentListOptions): { where: string; params: { [key: string]: Value } } {
    const parts: string[] = [];
    const params: { [key: string]: Value } = {};
    if (options.status) { parts.push('status = $status'); params.$status = options.status; }
    else parts.push("status != 'trash' AND status != 'spam'");
    if (options.resource) { parts.push('resource = $resource'); params.$resource = options.resource; }
    if (options.recordId) { parts.push('record_id = $record'); params.$record = options.recordId; }
    if (options.search?.trim()) {
        parts.push("(lower(content) LIKE $q ESCAPE '\\' OR lower(author_name) LIKE $q ESCAPE '\\' OR author_email LIKE $q ESCAPE '\\')");
        params.$q = containsPattern(options.search.trim().slice(0, 100));
    }
    return { where: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

function commentOf(row: readonly Value[]): CommentShape {
    return Object.freeze({
        id: row[0] as string, resource: row[1] as string, recordId: row[2] as string, parentId: row[3] as string | null, userId: row[4] as string | null,
        authorName: row[5] as string, authorEmail: row[6] as string, authorUrl: row[7] as string, content: row[8] as string, status: row[9] as CommentStatus,
        createdAt: Number(row[10] as bigint), updatedAt: Number(row[11] as bigint),
    });
}
