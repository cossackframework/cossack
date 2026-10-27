/**
 * Files: bytes in Cossack object storage (R2 on Workers, S3 or a local directory on Node),
 * ownership and metadata in RomeDB. Upload and delete are recoverable two-phase operations:
 * the metadata row records intent first, and `sweep()` finishes or cleans up interrupted work.
 */
import type { StorageProvider } from '@cossackframework/core/storage';
import type { RomeDB, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { imageSize, matchesSignature, MEDIA_FILTERS, MEDIA_TYPES, type MediaKind } from '../media';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';
import { containsPattern } from './users';
import { imageEditsProblems, transformable, variantRect, variantWidth, type ImageEdits } from '../images';
import { FORMAT_TYPES, negotiateFormat, type ImageTransformer } from './images';

export interface CmsFile {
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    readonly owner: string | null;
    readonly title: string;
    readonly alt: string;
    readonly caption: string;
    readonly description: string;
    readonly width: number | null;
    readonly height: number | null;
    /** Crop and focal point, for images. */
    readonly edits: ImageEdits | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface FileServiceOptions {
    /** Makes resized variants of images; without it, images serve as uploaded. */
    images?: ImageTransformer;
    now?: () => number;
    /** Largest accepted file. Default 25 MiB. */
    maxBytes?: number;
    /** Content types accepted; default `MEDIA_TYPES`. */
    contentTypes?: readonly string[];
    /** How long an unfinished upload or delete may wait before `sweep()` resolves it. Default 15 minutes. */
    staleMs?: number;
}

export interface FileMetadata {
    readonly title?: string;
    readonly alt?: string;
    readonly caption?: string;
    readonly description?: string;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const COLUMNS = 'id, name, content_type, size, owner_id, title, alt, caption, description, width, height, created_at, updated_at, edits';
const WRITE = { kind: 'cms.files', retryConflicts: 5 } as const;
/** Enough bytes to check a signature and read image dimensions behind typical metadata. */
const HEAD_BYTES = 1024 * 1024;

export class FileService {
    readonly #db: RomeDB;
    readonly #storage: StorageProvider;
    readonly #now: () => number;
    readonly #maxBytes: number;
    readonly #types: readonly string[];
    readonly #staleMs: number;
    readonly #images: ImageTransformer | undefined;
    #warned = false;

    constructor(db: RomeDB, storage: StorageProvider, options: FileServiceOptions = {}) {
        this.#db = db;
        this.#storage = storage;
        this.#now = options.now ?? Date.now;
        this.#maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
        this.#types = options.contentTypes ?? MEDIA_TYPES;
        this.#staleMs = options.staleMs ?? 15 * 60_000;
        this.#images = options.images;
    }

    get contentTypes(): readonly string[] { return this.#types; }

    /** Whether resized variants, crops and focal points apply. */
    get resizes(): boolean { return this.#images !== undefined; }

    /**
     * Crop an image or set its focal point; null clears both. Variants made before are removed,
     * and the file's version changes so pages link to new ones.
     */
    async setEdits(id: string, edits: ImageEdits | null, context: { principal: Principal }): Promise<CmsFile> {
        const file = await this.get(id);
        if (!file) throw new CmsError('CMS_NOT_FOUND', 'File not found.');
        this.#authorizeChange(file, context.principal, 'edit');
        if (!transformable(file.contentType) || !file.width || !file.height) throw new CmsError('CMS_VALIDATION', 'Only JPEG, PNG, WebP and AVIF images can be cropped.');
        const clean: ImageEdits | null = edits && (edits.crop || edits.focus) ? { ...(edits.crop ? { crop: edits.crop } : {}), ...(edits.focus ? { focus: edits.focus } : {}) } : null;
        const problems = clean ? imageEditsProblems(clean, file.width, file.height) : [];
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        await this.#db.write([{ rql: "UPDATE cms_files SET edits = $edits, updated_at = $now WHERE id = $id AND status = 'ready'",
            params: { $edits: clean ? JSON.stringify(clean) : null, $now: Math.max(this.#now(), file.updatedAt + 1), $id: id } }], WRITE);
        await this.#dropVariants(id);
        return (await this.get(id))!;
    }

    /**
     * A resized variant of an image, made on first request and kept in storage: `width` snaps to
     * `IMAGE_WIDTHS` and never exceeds the image; `height` crops to that shape around the focal
     * point. The format follows `accept`. Null when the file is missing or cannot be resized.
     */
    async variant(id: string, request: { width: number; height?: number; accept?: string; signal?: AbortSignal }): Promise<{ file: CmsFile; body: ReadableStream<Uint8Array>; contentType: string; size: number } | null> {
        const file = await this.get(id);
        if (!file || !this.#images || !transformable(file.contentType) || !file.width || !file.height) return null;
        if (!Number.isSafeInteger(request.width) || request.width < 1 || (request.height !== undefined && (!Number.isSafeInteger(request.height) || request.height < 1 || request.height > 10_000))) return null;
        const aspect = request.height ? variantWidth(request.width) / request.height : undefined;
        const rect = variantRect(file, aspect)!;
        const width = Math.min(variantWidth(request.width), rect.width);
        const height = Math.max(1, Math.round(width * rect.height / rect.width));
        const format = negotiateFormat(request.accept, file.contentType);
        const key = `cms/variants/${id}/${file.updatedAt}/${width}x${height}${request.height ? 'c' : ''}.${format}`;
        const contentType = FORMAT_TYPES[format];
        const stored = await this.#storage.get(key, request.signal ? { signal: request.signal } : {});
        if (stored) return { file, body: stored.body, contentType, size: stored.size };
        const original = await this.#storage.get(`cms/files/${id}`, request.signal ? { signal: request.signal } : {});
        if (!original) return null;
        let bytes: Uint8Array;
        try {
            bytes = await this.#images.transform(original.body, { rect, source: { width: file.width, height: file.height }, width, height, format, quality: format === 'avif' ? 60 : 78 });
        } catch (error) {
            // A transformer that cannot run, such as sharp missing on Node, leaves the original.
            if (!this.#warned) console.warn('[cms] could not resize images; serving originals.', error);
            this.#warned = true;
            return null;
        }
        await this.#db.write([{ rql: 'INSERT INTO cms_file_variants (key, file_id, created_at) VALUES ($key, $id, $now) ON CONFLICT (key) DO NOTHING', params: { $key: key, $id: id, $now: this.#now() } }], WRITE);
        await this.#storage.put(key, streamOf(bytes), { size: bytes.byteLength, contentType });
        return { file, body: streamOf(bytes), contentType, size: bytes.byteLength };
    }

    async #dropVariants(id: string): Promise<void> {
        const result = await this.#db.read([{ rql: 'SELECT key FROM cms_file_variants WHERE file_id = $id LIMIT 500', params: { $id: id } }]);
        for (const [key] of result.results[0]!.rows) await this.#storage.delete(key as string).catch(() => undefined);
        await this.#db.write([{ rql: 'DELETE FROM cms_file_variants WHERE file_id = $id', params: { $id: id } }], WRITE);
    }

    /**
     * Record intent, store the bytes, then mark the file ready. The declared type must match
     * the file's signature; image dimensions are read from its first bytes.
     */
    async upload(file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> } & FileMetadata,
        context: { principal: Principal; signal?: AbortSignal; maxBytes?: number; owner?: string }): Promise<CmsFile> {
        if (!hasPermission(context.principal, PERMISSIONS.upload) && !hasPermission(context.principal, PERMISSIONS.manageMedia)) {
            throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to upload files.');
        }
        const maxBytes = Math.min(context.maxBytes ?? this.#maxBytes, this.#maxBytes);
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) throw new CmsError('CMS_LIMIT', `Files must be 1 byte to ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
        const contentType = file.contentType.split(';')[0]!.trim().toLowerCase();
        if (!this.#types.includes(contentType)) throw new CmsError('CMS_VALIDATION', `Files of type ${contentType || 'unknown'} are not accepted.`);
        const { head, body } = await peek(file.body, Math.min(HEAD_BYTES, file.size));
        if (!matchesSignature(contentType, head)) {
            await body.cancel().catch(() => undefined);
            throw new CmsError('CMS_VALIDATION', `The file is not a valid ${contentType} file.`);
        }
        const dimensions = imageSize(contentType, head);
        const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200) || 'file';
        const id = crypto.randomUUID();
        const key = `cms/files/${id}`;
        const now = this.#now();
        // Host work, such as storing an avatar, names the user the file belongs to.
        const owner = context.principal.kind === 'user' ? context.principal.id : context.principal.kind === 'system' ? context.owner ?? null : null;
        const metadata = checkMetadata({ title: file.title ?? name.replace(/\.[^.]+$/, ''), alt: file.alt ?? '', caption: file.caption ?? '', description: file.description ?? '' });
        await this.#db.write([{
            rql: `INSERT INTO cms_files (id, key, owner_id, name, content_type, size, status, title, alt, caption, description, width, height, created_at, updated_at)
                VALUES ($id, $key, $owner, $name, $type, $size, 'pending', $title, $alt, $caption, $description, $width, $height, $now, $now)`,
            params: { $id: id, $key: key, $owner: owner, $name: name, $type: contentType, $size: file.size, ...prefixed(metadata), $width: dimensions?.width ?? null, $height: dimensions?.height ?? null, $now: now },
        }], WRITE);
        await this.#storage.put(key, body, { size: file.size, contentType, ...(context.signal ? { signal: context.signal } : {}) });
        const ready = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'ready', updated_at = $now WHERE id = $id AND status = 'pending'", params: { $id: id, $now: this.#now() } }], WRITE);
        if (ready.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The upload was cancelled.');
        return (await this.get(id))!;
    }

    async get(id: string): Promise<CmsFile | null> {
        if (!ID.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_files WHERE id = $id AND status = 'ready'`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? fileOf(row) : null;
    }

    async getMany(ids: readonly string[]): Promise<Map<string, CmsFile>> {
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 200);
        if (!wanted.length) return new Map();
        const params = Object.fromEntries(wanted.map((id, index) => [`$f${index}`, id]));
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_files WHERE status = 'ready' AND id IN (${wanted.map((_, index) => `$f${index}`).join(', ')})`, params }]);
        return new Map(result.results[0]!.rows.map(row => { const file = fileOf(row); return [file.id, file]; }));
    }

    /** Ready files, newest first, filtered by kind, owner and a search over name and title. */
    async list(options: { kind?: MediaKind; search?: string; owner?: string; limit?: number; offset?: number } = {}): Promise<{ items: CmsFile[]; total: number }> {
        const conditions = ["status = 'ready'"];
        const params: { [key: string]: Value } = {};
        if (options.kind) {
            const prefixes = MEDIA_FILTERS[options.kind];
            if (!prefixes) throw new CmsError('CMS_VALIDATION', `Unknown media kind ${options.kind}.`);
            conditions.push(`(${prefixes.map((prefix, index) => { params[`$k${index}`] = `${prefix}%`; return `content_type LIKE $k${index}`; }).join(' OR ')})`);
        }
        if (options.search?.trim()) {
            conditions.push("(lower(name) LIKE $q ESCAPE '\\' OR lower(title) LIKE $q ESCAPE '\\')");
            params.$q = containsPattern(options.search.trim().slice(0, 100));
        }
        if (options.owner) { conditions.push('owner_id = $owner'); params.$owner = options.owner; }
        const where = conditions.join(' AND ');
        const result = await this.#db.read([
            { rql: `SELECT ${COLUMNS} FROM cms_files WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset`,
                params: { ...params, $limit: Math.min(Math.max(options.limit ?? 40, 1), 100), $offset: Math.min(Math.max(options.offset ?? 0, 0), 100_000) } },
            Object.keys(params).length ? { rql: `SELECT count(*) FROM cms_files WHERE ${where}`, params } : { rql: `SELECT count(*) FROM cms_files WHERE ${where}` },
        ]);
        return { items: result.results[0]!.rows.map(fileOf), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /** Change title, alt text, caption or description. The owner or a media manager may edit. */
    async update(id: string, patch: FileMetadata, context: { principal: Principal }): Promise<CmsFile> {
        const file = await this.get(id);
        if (!file) throw new CmsError('CMS_NOT_FOUND', 'File not found.');
        this.#authorizeChange(file, context.principal, 'edit');
        const next = checkMetadata({ title: patch.title ?? file.title, alt: patch.alt ?? file.alt, caption: patch.caption ?? file.caption, description: patch.description ?? file.description });
        await this.#db.write([{ rql: "UPDATE cms_files SET title = $title, alt = $alt, caption = $caption, description = $description, updated_at = $now WHERE id = $id AND status = 'ready'",
            params: { ...prefixed(next), $now: this.#now(), $id: id } }], WRITE);
        return (await this.get(id))!;
    }

    async open(id: string, options: { signal?: AbortSignal } = {}): Promise<{ file: CmsFile; body: ReadableStream<Uint8Array> } | null> {
        const file = await this.get(id);
        if (!file) return null;
        const object = await this.#storage.get(`cms/files/${id}`, options);
        return object ? { file, body: object.body } : null;
    }

    /** Mark for deletion, delete the bytes, then the row. The owner or a media manager may delete. */
    async delete(id: string, context: { principal: Principal }): Promise<void> {
        const file = await this.get(id);
        if (!file) throw new CmsError('CMS_NOT_FOUND', 'File not found.');
        this.#authorizeChange(file, context.principal, 'delete');
        const marked = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'deleting', updated_at = $now WHERE id = $id AND status = 'ready'", params: { $id: id, $now: this.#now() } }], WRITE);
        if (marked.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The file is already being deleted.');
        await this.#finishDelete(id);
    }

    /** Resolve interrupted work: stale pending uploads are removed; stale deletes are completed. */
    async sweep(options: { limit?: number } = {}): Promise<{ removed: number }> {
        const before = this.#now() - this.#staleMs;
        const result = await this.#db.read([{
            rql: "SELECT id FROM cms_files WHERE status IN ('pending', 'deleting') AND updated_at <= $before ORDER BY updated_at LIMIT $limit",
            params: { $before: before, $limit: options.limit ?? 50 },
        }]);
        let removed = 0;
        for (const [id] of result.results[0]!.rows) {
            const claimed = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'deleting', updated_at = $now WHERE id = $id AND status IN ('pending', 'deleting') AND updated_at <= $before",
                params: { $id: id!, $now: this.#now(), $before: before } }], WRITE);
            if (claimed.results[0]!.affected !== 1n) continue;
            await this.#finishDelete(id as string);
            removed++;
        }
        return { removed };
    }

    #authorizeChange(file: CmsFile, principal: Principal, action: 'edit' | 'delete'): void {
        const own = principal.kind === 'user' && file.owner === principalId(principal) && hasPermission(principal, PERMISSIONS.upload);
        if (!own && !hasPermission(principal, PERMISSIONS.manageMedia)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', `Not allowed to ${action} this file.`);
    }

    async #finishDelete(id: string): Promise<void> {
        await this.#dropVariants(id);
        await this.#storage.delete(`cms/files/${id}`);
        await this.#db.write([{ rql: "DELETE FROM cms_files WHERE id = $id AND status = 'deleting'", params: { $id: id } }], WRITE);
    }
}

/** Read up to `bytes` from the start of a stream, and a stream that replays them followed by the rest. */
async function peek(source: ReadableStream<Uint8Array>, bytes: number): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
    const reader = source.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    while (size < bytes) {
        const next = await reader.read();
        if (next.done) { done = true; break; }
        chunks.push(next.value);
        size += next.value.byteLength;
    }
    const head = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { head.set(chunk, offset); offset += chunk.byteLength; }
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            if (head.byteLength) controller.enqueue(head);
            if (done) controller.close();
        },
        async pull(controller) {
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
        },
        cancel(reason) { return reader.cancel(reason); },
    });
    return { head, body };
}

function checkMetadata(metadata: Required<FileMetadata>): Required<FileMetadata> {
    const limits = { title: 200, alt: 300, caption: 1000, description: 5000 } as const;
    const fields: { [name: string]: string } = {};
    for (const [name, limit] of Object.entries(limits)) {
        const value = metadata[name as keyof FileMetadata];
        if (typeof value !== 'string' || value.length > limit) fields[name] = `must be at most ${limit} characters.`;
    }
    if (Object.keys(fields).length) throw new CmsError('CMS_VALIDATION', 'Some file details are invalid.', { fields });
    return { title: metadata.title.trim(), alt: metadata.alt.trim(), caption: metadata.caption.trim(), description: metadata.description.trim() };
}

function prefixed(metadata: Required<FileMetadata>): { [key: string]: Value } {
    return { $title: metadata.title, $alt: metadata.alt, $caption: metadata.caption, $description: metadata.description };
}

function fileOf(row: readonly Value[]): CmsFile {
    return Object.freeze({
        id: row[0] as string, name: row[1] as string, contentType: row[2] as string, size: Number(row[3] as bigint), owner: row[4] as string | null,
        title: row[5] as string, alt: row[6] as string, caption: row[7] as string, description: row[8] as string,
        width: row[9] === null ? null : Number(row[9] as bigint), height: row[10] === null ? null : Number(row[10] as bigint),
        edits: row[13] ? parseEdits(row[13] as string) : null,
        createdAt: Number(row[11] as bigint), updatedAt: Number(row[12] as bigint),
    });
}

function parseEdits(text: string): ImageEdits | null {
    try { return JSON.parse(text) as ImageEdits; } catch { return null; }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}
