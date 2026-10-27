/**
 * Files: bytes in Cossack object storage (R2 on Workers, S3 or a local directory on Node),
 * ownership and metadata in RomeDB. Upload and delete are recoverable two-phase operations:
 * the metadata row records intent first, and `sweep()` finishes or cleans up interrupted work.
 */
import type { StoragePresignedUpload, StorageProvider } from '@cossackframework/core/storage';
import type { RomeDB, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { declaredType, imageSize, matchesSignature, MEDIA_FILTER_EXCLUDES, MEDIA_FILTERS, sanitizeSvg, SVG_TYPE, type MediaKind } from '../media';
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
    /** Largest accepted file. Default: no limit beyond what the caller passes. */
    maxBytes?: number;
    /** Content types accepted. Default: every type. */
    contentTypes?: readonly string[];
    /** How long an unfinished upload or delete may wait before `sweep()` resolves it. Default 15 minutes. */
    staleMs?: number;
    /** How long a presigned upload URL stays valid. Default one hour. */
    presignSeconds?: number;
}

/** An upload the browser sends itself: where to PUT the bytes, then `complete()` makes the file. */
export interface PendingUpload {
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    /** The provider's presigned PUT, or null when the bytes go through the application (`receive()`). */
    readonly direct: StoragePresignedUpload | null;
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
/** SVG is sanitized as text, so it is held in memory; larger files are refused. */
const SVG_MAX_BYTES = 8 * 1024 * 1024;

export class FileService {
    readonly #db: RomeDB;
    readonly #storage: StorageProvider;
    readonly #now: () => number;
    readonly #maxBytes: number;
    readonly #types: readonly string[] | null;
    readonly #staleMs: number;
    readonly #presignSeconds: number;
    readonly #images: ImageTransformer | undefined;
    #warned = false;

    constructor(db: RomeDB, storage: StorageProvider, options: FileServiceOptions = {}) {
        this.#db = db;
        this.#storage = storage;
        this.#now = options.now ?? Date.now;
        this.#maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
        this.#types = options.contentTypes ?? null;
        this.#staleMs = options.staleMs ?? 15 * 60_000;
        this.#presignSeconds = options.presignSeconds ?? 3600;
        this.#images = options.images;
    }

    /** The accepted content types, or null for every type. */
    get contentTypes(): readonly string[] | null { return this.#types; }

    /** Whether the provider presigns uploads, so browsers send bytes to the bucket directly. */
    get direct(): boolean { return typeof this.#storage.presign === 'function'; }

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
     * the file's signature; image dimensions are read from its first bytes; SVG is sanitized.
     */
    async upload(file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> } & FileMetadata,
        context: { principal: Principal; signal?: AbortSignal; maxBytes?: number; owner?: string }): Promise<CmsFile> {
        const { id, key, contentType } = await this.#begin(file, context);
        const { head, body } = await peek(file.body, Math.min(HEAD_BYTES, file.size));
        if (!matchesSignature(contentType, head)) {
            await body.cancel().catch(() => undefined);
            await this.#abandon(id);
            throw new CmsError('CMS_VALIDATION', `The file is not a valid ${contentType} file.`);
        }
        let size = file.size;
        try {
            if (contentType === SVG_TYPE) {
                const clean = await this.#cleanSvg(id, body, file.size);
                size = clean.byteLength;
                await this.#storage.put(key, streamOf(clean), { size, contentType, ...(context.signal ? { signal: context.signal } : {}) });
            } else await this.#storage.put(key, body, { size, contentType, ...(context.signal ? { signal: context.signal } : {}) });
        } catch (error) {
            if (!(error instanceof CmsError)) await this.#abandon(id).catch(() => undefined);
            throw error;
        }
        return this.#ready(id, size, imageSize(contentType, head));
    }

    /**
     * Start an upload the browser sends itself. The row records intent; the bytes go to
     * `direct` (the bucket's presigned URL) or through `receive()`; `complete()` checks them
     * and makes the file. Stale uploads that never complete are swept.
     */
    async begin(file: { name: string; contentType: string; size: number } & FileMetadata, context: { principal: Principal; maxBytes?: number; owner?: string }): Promise<PendingUpload> {
        const { id, key, name, contentType } = await this.#begin(file, context);
        let direct: StoragePresignedUpload | null = null;
        if (this.#storage.presign) {
            try { direct = await this.#storage.presign(key, { size: file.size, contentType, expiresIn: this.#presignSeconds }); }
            catch { direct = null; }
        }
        return { id, name, contentType, size: file.size, direct };
    }

    /** Store the bytes of an upload the browser sends through the application, as begun. */
    async receive(id: string, body: ReadableStream<Uint8Array>, context: { principal: Principal; signal?: AbortSignal }): Promise<void> {
        const pending = await this.#pending(id, context.principal);
        await this.#storage.put(pending.key, body, { size: pending.size, contentType: pending.contentType, ...(context.signal ? { signal: context.signal } : {}) });
    }

    /**
     * Finish an upload: the object must exist with the declared size and a matching signature.
     * SVG is sanitized in place; image dimensions are read. A failed check removes both the
     * object and the row.
     */
    async complete(id: string, context: { principal: Principal; signal?: AbortSignal }): Promise<CmsFile> {
        const pending = await this.#pending(id, context.principal);
        const refuse = async (message: string) => { await this.#abandon(id); return new CmsError('CMS_VALIDATION', message); };
        const stored = await this.#storage.head(pending.key, context.signal ? { signal: context.signal } : {});
        if (!stored) throw await refuse('The upload did not finish.');
        if (stored.size !== pending.size) throw await refuse(`The upload has ${stored.size} bytes, not the ${pending.size} declared.`);
        const object = await this.#storage.get(pending.key, context.signal ? { signal: context.signal } : {});
        if (!object) throw await refuse('The upload did not finish.');
        const { head, body } = await peek(object.body, Math.min(HEAD_BYTES, pending.size));
        if (!matchesSignature(pending.contentType, head)) {
            await body.cancel().catch(() => undefined);
            throw await refuse(`The file is not a valid ${pending.contentType} file.`);
        }
        let size = pending.size;
        if (pending.contentType === SVG_TYPE) {
            const clean = await this.#cleanSvg(id, body, pending.size);
            size = clean.byteLength;
            await this.#storage.put(pending.key, streamOf(clean), { size, contentType: pending.contentType });
        } else await body.cancel().catch(() => undefined);
        return this.#ready(id, size, imageSize(pending.contentType, head));
    }

    /** Check the upload and record intent; the row is pending until the bytes are in. */
    async #begin(file: { name: string; contentType: string; size: number } & FileMetadata, context: { principal: Principal; maxBytes?: number; owner?: string }): Promise<{ id: string; key: string; name: string; contentType: string }> {
        if (!hasPermission(context.principal, PERMISSIONS.upload) && !hasPermission(context.principal, PERMISSIONS.manageMedia)) {
            throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to upload files.');
        }
        const maxBytes = Math.min(context.maxBytes ?? this.#maxBytes, this.#maxBytes);
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) throw new CmsError('CMS_LIMIT', maxBytes === Number.MAX_SAFE_INTEGER ? 'Files must be at least 1 byte.' : `Files must be 1 byte to ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
        const contentType = declaredType(file.contentType);
        if (this.#types && !this.#types.includes(contentType)) throw new CmsError('CMS_VALIDATION', `Files of type ${contentType} are not accepted.`);
        if (contentType === SVG_TYPE && file.size > SVG_MAX_BYTES) throw new CmsError('CMS_LIMIT', `SVG files must be at most ${SVG_MAX_BYTES / 1024 / 1024} MB.`);
        const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200) || 'file';
        const id = crypto.randomUUID();
        const key = `cms/files/${id}`;
        const now = this.#now();
        // Host work, such as storing an avatar, names the user the file belongs to.
        const owner = context.principal.kind === 'user' ? context.principal.id : context.principal.kind === 'system' ? context.owner ?? null : null;
        const metadata = checkMetadata({ title: file.title ?? name.replace(/\.[^.]+$/, ''), alt: file.alt ?? '', caption: file.caption ?? '', description: file.description ?? '' });
        await this.#db.write([{
            rql: `INSERT INTO cms_files (id, key, owner_id, name, content_type, size, status, title, alt, caption, description, width, height, created_at, updated_at)
                VALUES ($id, $key, $owner, $name, $type, $size, 'pending', $title, $alt, $caption, $description, NULL, NULL, $now, $now)`,
            params: { $id: id, $key: key, $owner: owner, $name: name, $type: contentType, $size: file.size, ...prefixed(metadata), $now: now },
        }], WRITE);
        return { id, key, name, contentType };
    }

    /** A pending upload the principal may finish: its owner, a media manager, or host work. */
    async #pending(id: string, principal: Principal): Promise<{ key: string; owner: string | null; contentType: string; size: number }> {
        if (!ID.test(id)) throw new CmsError('CMS_NOT_FOUND', 'Upload not found.');
        const result = await this.#db.read([{ rql: "SELECT key, owner_id, content_type, size FROM cms_files WHERE id = $id AND status = 'pending'", params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        if (!row) throw new CmsError('CMS_NOT_FOUND', 'Upload not found.');
        const pending = { key: row[0] as string, owner: row[1] as string | null, contentType: row[2] as string, size: Number(row[3] as bigint) };
        const own = principal.kind === 'user' && pending.owner === principalId(principal) && hasPermission(principal, PERMISSIONS.upload);
        if (!own && principal.kind !== 'system' && !hasPermission(principal, PERMISSIONS.manageMedia)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to finish this upload.');
        return pending;
    }

    /** Sanitized SVG bytes from the stream; refuses what is not an SVG document. */
    async #cleanSvg(id: string, body: ReadableStream<Uint8Array>, size: number): Promise<Uint8Array> {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        const clean = bytes.byteLength <= Math.max(size, SVG_MAX_BYTES) ? sanitizeSvg(new TextDecoder().decode(bytes)) : null;
        if (clean === null) { await this.#abandon(id); throw new CmsError('CMS_VALIDATION', 'The file is not a valid SVG document.'); }
        return new TextEncoder().encode(clean);
    }

    async #ready(id: string, size: number, dimensions: { width: number; height: number } | null): Promise<CmsFile> {
        const ready = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'ready', size = $size, width = $width, height = $height, updated_at = $now WHERE id = $id AND status = 'pending'",
            params: { $id: id, $size: size, $width: dimensions?.width ?? null, $height: dimensions?.height ?? null, $now: this.#now() } }], WRITE);
        if (ready.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The upload was cancelled.');
        return (await this.get(id))!;
    }

    /** Drop a pending upload: its bytes, if any, and its row. */
    async #abandon(id: string): Promise<void> {
        const marked = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'deleting', updated_at = $now WHERE id = $id AND status = 'pending'", params: { $id: id, $now: this.#now() } }], WRITE);
        if (marked.results[0]!.affected === 1n) await this.#finishDelete(id);
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
            const excluded = MEDIA_FILTER_EXCLUDES[options.kind] ?? [];
            if (excluded.length) conditions.push(`content_type NOT IN (${excluded.map((type, index) => { params[`$x${index}`] = type; return `$x${index}`; }).join(', ')})`);
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
