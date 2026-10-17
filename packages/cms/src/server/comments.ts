/**
 * Comments on entries, with moderation: pending, approved, spam and trash. The host checks
 * the entry and the Discussion settings before posting; this class keeps the rows.
 */
import type { FastDB, Statement, Value } from '@cossackframework/fastdb';
import { CmsError } from '../errors';
import { containsPattern, inList } from './users';
import { checkComment, COMMENT_STATUSES, type CommentRow, type CommentShape, type CommentStatus } from '../comments';

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
    readonly #db: FastDB;
    readonly #now: () => number;

    constructor(db: FastDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    async get(id: string): Promise<CommentShape | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ sql: `SELECT ${COLUMNS} FROM cms_comments WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? commentOf(row) : null;
    }

    /** Comments for the moderation screen, newest first. */
    async list(options: CommentListOptions = {}): Promise<{ items: CommentShape[]; total: number }> {
        const { where, params } = conditions(options);
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const offset = Math.min(Math.max(options.offset ?? 0, 0), 10_000);
        const result = await this.#db.read([
            { sql: `SELECT ${COLUMNS} FROM cms_comments${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, ...(Object.keys(params).length ? { params } : {}) },
            { sql: `SELECT count(*) FROM cms_comments${where}`, ...(Object.keys(params).length ? { params } : {}) },
        ]);
        return { items: result.results[0]!.rows.map(commentOf), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /** How many comments have each status. */
    async counts(): Promise<{ [K in CommentStatus]: number }> {
        const result = await this.#db.read(COMMENT_STATUSES.map(status => ({ sql: 'SELECT count(*) FROM cms_comments WHERE status = $status', params: { $status: status } })));
        return Object.fromEntries(COMMENT_STATUSES.map((status, index) => [status, Number(result.results[index]!.rows[0]![0] as bigint)])) as { [K in CommentStatus]: number };
    }

    /** An entry's comments with one status, oldest first, at most 500. */
    async forEntry(resource: string, recordId: string, status: CommentStatus = 'approved'): Promise<CommentShape[]> {
        const result = await this.#db.read([{
            sql: `SELECT ${COLUMNS} FROM cms_comments WHERE resource = $resource AND record_id = $record AND status = $status ORDER BY created_at, id LIMIT 500`,
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
            sql: `SELECT record_id, count(*) FROM cms_comments WHERE resource = $resource AND status = 'approved' AND record_id IN ${list.sql} GROUP BY record_id`,
            params: { $resource: resource, ...list.params },
        }]);
        return new Map(result.results[0]!.rows.map(([id, count]) => [id as string, Number(count as bigint)]));
    }

    /** Whether the email has an approved comment, for "approve returning commenters". */
    async hasApproved(email: string): Promise<boolean> {
        if (!email) return false;
        const result = await this.#db.read([{ sql: "SELECT 1 FROM cms_comments WHERE author_email = $email AND status = 'approved' LIMIT 1", params: { $email: email.toLowerCase() } }]);
        return result.results[0]!.rows.length > 0;
    }

    /** When the address last commented, for throttling. */
    async lastFrom(ipHash: string): Promise<number | null> {
        const result = await this.#db.read([{ sql: 'SELECT created_at FROM cms_comments WHERE ip_hash = $ip ORDER BY created_at DESC LIMIT 1', params: { $ip: ipHash } }]);
        const row = result.results[0]!.rows[0];
        return row ? Number(row[0] as bigint) : null;
    }

    /** The insert statement for a new comment, so callers can batch it. */
    insert(row: Omit<CommentRow, 'createdAt' | 'updatedAt'>): Statement {
        const now = this.#now();
        return {
            sql: `INSERT INTO cms_comments (id, resource, record_id, parent_id, user_id, author_name, author_email, author_url, content, status, ip_hash, user_agent, created_at, updated_at)
                VALUES ($id, $resource, $record, $parent, $user, $name, $email, $url, $content, $status, $ip, $agent, $now, $now)`,
            params: {
                $id: row.id, $resource: row.resource, $record: row.recordId, $parent: row.parentId, $user: row.userId, $name: row.authorName, $email: row.authorEmail.toLowerCase(),
                $url: row.authorUrl, $content: row.content, $status: row.status, $ip: row.ipHash, $agent: row.userAgent, $now: now,
            },
        };
    }

    async create(row: Omit<CommentRow, 'createdAt' | 'updatedAt'>): Promise<CommentShape> {
        await this.#db.write([this.insert(row)], WRITE);
        return (await this.get(row.id))!;
    }

    /** Approve, unapprove, mark as spam or trash comments. */
    async setStatus(ids: readonly string[], status: CommentStatus): Promise<number> {
        if (!COMMENT_STATUSES.includes(status)) throw new CmsError('CMS_VALIDATION', 'Unknown comment status.');
        const wanted = [...new Set(ids.filter(id => ID.test(id)))].slice(0, 100);
        if (!wanted.length) return 0;
        const list = inList('c', wanted);
        const result = await this.#db.write([{ sql: `UPDATE cms_comments SET status = $status, updated_at = $now WHERE id IN ${list.sql}`, params: { $status: status, $now: this.#now(), ...list.params } }], WRITE);
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
            sql: 'UPDATE cms_comments SET content = $content, author_name = $name, author_email = $email, author_url = $url, updated_at = $now WHERE id = $id',
            params: { $content: next.content, $name: next.authorName, $email: next.authorEmail.toLowerCase(), $url: next.authorUrl, $now: this.#now(), $id: id },
        }], WRITE);
        return (await this.get(id))!;
    }

    /** Delete comments permanently. Their replies move up to the deleted comment's parent. */
    async delete(ids: readonly string[]): Promise<void> {
        const comments = (await Promise.all([...new Set(ids)].slice(0, 100).map(id => this.get(id)))).filter((comment): comment is CommentShape => comment !== null);
        if (!comments.length) return;
        const statements: Statement[] = [];
        for (const comment of comments) {
            statements.push({ sql: 'UPDATE cms_comments SET parent_id = $parent WHERE parent_id = $id', params: { $parent: comment.parentId, $id: comment.id } });
            statements.push({ sql: 'DELETE FROM cms_comments WHERE id = $id', params: { $id: comment.id } });
        }
        for (let index = 0; index < statements.length; index += 30) await this.#db.write(statements.slice(index, index + 30), WRITE);
    }

    /** Delete an entry's comments, after the entry is deleted. */
    async deleteForEntry(resource: string, recordId: string): Promise<void> {
        await this.#db.write([{ sql: 'DELETE FROM cms_comments WHERE id IN (SELECT id FROM cms_comments WHERE resource = $resource AND record_id = $record LIMIT 1000)', params: { $resource: resource, $record: recordId } }], WRITE);
    }
}

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
