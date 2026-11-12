/**
 * Files: bytes in Cossack object storage (R2 on Workers, S3 or a local directory on Node),
 * ownership and metadata in RomeDB. Upload and delete are recoverable two-phase operations:
 * the metadata row records intent first, and `sweep()` finishes or cleans up interrupted work.
 */
import type { StoragePresignedUpload, StorageProvider } from '@cossackframework/core/storage';
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { declaredType, imageHasAlpha, imageSize, matchesSignature, MEDIA_FILTER_EXCLUDES, MEDIA_FILTERS, mediaKind, sanitizeSvg, SVG_TYPE, type MediaKind } from '../media';
import { hasPermission, PERMISSIONS, principalId, type Principal } from '../permissions';
import { containsPattern } from './users';
import { IMAGE_WIDTHS, imageEditsProblems, transformable, variantRect, variantWidth, type ImageEdits } from '../images';
import { FORMAT_TYPES, negotiateFormat, type ImageFormat, type ImageTransformer } from './images';
import { uuidv7 } from '@cossackframework/core';
import { readByIds, readPaged } from './budget';

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
    /** A blurred stand-in of the image as a `data:` URL, a few hundred bytes, shown while it loads; null for other files. */
    readonly placeholder: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface FileServiceOptions {
    /** Makes resized variants of images; without it, images serve as uploaded. */
    images?: ImageTransformer;
    now?: () => number;
    /** Largest accepted file. Default: no limit beyond what the caller passes. */
    maxBytes?: number;
    /** Called after a file's details change or a file is deleted, for the host to purge the pages that show it. */
    changed?: () => void | Promise<void>;
    /** Content types accepted. Default: every type. */
    contentTypes?: readonly string[];
    /** How long an unfinished upload or delete may wait before `sweep()` resolves it. Default 15 minutes. */
    staleMs?: number;
    /** How long a presigned upload URL stays valid. Default one hour. */
    presignSeconds?: number;
    /** The site's image settings (Settings → Files); `IMAGE_WIDTHS`, quality 78 and no downscaling without it. */
    imageSettings?: () => Promise<ImageSettings>;
}

/** How images are resized: the variants' widths, their quality, and the widest original kept (0 for any). */
export interface ImageSettings {
    readonly widths: readonly number[];
    readonly quality: number;
    readonly maxWidth: number;
}

/** What the library holds: files and bytes in all and by kind, and the resized copies made of images. */
export interface FileSummary {
    readonly files: number;
    readonly bytes: number;
    readonly kinds: readonly { readonly kind: MediaKind; readonly files: number; readonly bytes: number }[];
    /** Copies made before their size was recorded count in `files` alone. */
    readonly variants: { readonly files: number; readonly bytes: number };
}

const DEFAULT_IMAGES: ImageSettings = { widths: IMAGE_WIDTHS, quality: 78, maxWidth: 0 };
const OWN_FORMAT: { readonly [type: string]: ImageFormat } = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

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
/**
 * Private files, such as a form's uploads, live in a key space of their own:
 * `cms/private/<scope>/<id>` against the library's `cms/files/<id>`. Every library read
 * (`get`, `getMany`, `list`, `summary`, and through them `open`, `variant`, the public
 * `/media/` route and media references in content) selects library keys alone, so a private
 * file's ID resolves nowhere public; only `openPrivate`, given the file's scope, reads it, and
 * its caller decides who may (forms: `cms:submissions`). The key marks them rather than a
 * status of their own because `cms_files.status` is fixed to pending, ready and deleting, and
 * keeping them in `cms_files` keeps the two-phase upload and `sweep()` for them.
 */
export const LIBRARY_KEYS = "key LIKE 'cms/files/%'";
const PRIVATE_PREFIX = 'cms/private/';
/** A scope of private files: path segments of letters, digits, `_` and `-`, such as `forms/<form>/<submission>`. */
const SCOPE = /^[A-Za-z0-9_-]{1,80}(?:\/[A-Za-z0-9_-]{1,80}){0,4}$/;
const COLUMNS = 'id, name, content_type, size, owner_id, title, alt, caption, description, width, height, created_at, updated_at, edits, placeholder';
/** The width of the placeholder the transformer makes; the browser blurs it up to the image's size. */
const PLACEHOLDER_WIDTH = 16;
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
    readonly #changed: (() => void | Promise<void>) | undefined;
    readonly #types: readonly string[] | null;
    readonly #staleMs: number;
    readonly #presignSeconds: number;
    readonly #images: ImageTransformer | undefined;
    readonly #imageSettings: () => Promise<ImageSettings>;
    #warned = false;
    /** Variants being made, by key: concurrent first requests for one share its transform. */
    readonly #making = new Map<string, Promise<Uint8Array | null>>();

    constructor(db: RomeDB, storage: StorageProvider, options: FileServiceOptions = {}) {
        this.#db = db;
        this.#storage = storage;
        this.#now = options.now ?? Date.now;
        this.#changed = options.changed;
        this.#maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
        this.#types = options.contentTypes ?? null;
        this.#staleMs = options.staleMs ?? 15 * 60_000;
        this.#presignSeconds = options.presignSeconds ?? 3600;
        this.#images = options.images;
        this.#imageSettings = options.imageSettings ?? (async () => DEFAULT_IMAGES);
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
        // The placeholder shows the crop.
        return this.#placeholder((await this.get(id))!);
    }

    /**
     * Scale an image wider than the largest width of Settings → Files down to it, in its own
     * format, replacing the original. Other files, and transformers that fail, keep the upload.
     */
    async #shrink(file: CmsFile): Promise<CmsFile> {
        const { maxWidth, quality } = await this.#imageSettings();
        const format = OWN_FORMAT[file.contentType];
        if (!this.#images || !maxWidth || !format || !file.width || !file.height || file.width <= maxWidth) return file;
        const original = await this.#storage.get(`cms/files/${file.id}`);
        if (!original) return file;
        const height = Math.max(1, Math.round(file.height * maxWidth / file.width));
        let bytes: Uint8Array;
        try {
            bytes = await this.#images.transform(original.body, { rect: { x: 0, y: 0, width: file.width, height: file.height }, source: { width: file.width, height: file.height }, width: maxWidth, height, format, quality });
        } catch (error) {
            if (!this.#warned) console.warn('[cms] could not scale down a large image; keeping it as uploaded.', error);
            this.#warned = true;
            return file;
        }
        await this.#storage.put(`cms/files/${file.id}`, streamOf(bytes), { size: bytes.byteLength, contentType: file.contentType });
        await this.#db.write([{ rql: "UPDATE cms_files SET size = $size, width = $width, height = $height WHERE id = $id AND status = 'ready'",
            params: { $size: bytes.byteLength, $width: maxWidth, $height: height, $id: file.id } }], WRITE);
        return { ...file, size: bytes.byteLength, width: maxWidth, height };
    }

    /** Count the library by kind, and the resized copies; one read. */
    async summary(): Promise<FileSummary> {
        const result = await this.#db.read([
            { rql: `SELECT content_type, count(*), sum(size) FROM cms_files WHERE status = 'ready' AND ${LIBRARY_KEYS} GROUP BY content_type` },
            { rql: 'SELECT count(*), sum(size) FROM cms_file_variants' },
        ]);
        const kinds = new Map<MediaKind, { files: number; bytes: number }>();
        for (const [type, count, bytes] of result.results[0]!.rows) {
            const kind = mediaKind(String(type));
            const entry = kinds.get(kind) ?? { files: 0, bytes: 0 };
            kinds.set(kind, { files: entry.files + Number(count as bigint), bytes: entry.bytes + Number((bytes as bigint | null) ?? 0) });
        }
        const list = [...kinds].map(([kind, entry]) => ({ kind, ...entry })).sort((a, b) => b.bytes - a.bytes);
        const [variantFiles, variantBytes] = result.results[1]!.rows[0] ?? [0n, null];
        return {
            files: list.reduce((sum, entry) => sum + entry.files, 0), bytes: list.reduce((sum, entry) => sum + entry.bytes, 0), kinds: list,
            variants: { files: Number(variantFiles as bigint), bytes: Number((variantBytes as bigint | null) ?? 0) },
        };
    }

    /**
     * Make the image's placeholder: the cropped image at 16 pixels wide as WebP, kept on the
     * row as a `data:` URL. Files that are not images, images with transparency (the blur would
     * show through them once loaded) and transformers that fail leave none.
     */
    async #placeholder(file: CmsFile): Promise<CmsFile> {
        if (!this.#images || !transformable(file.contentType) || !file.width || !file.height) return file;
        const rect = variantRect(file)!;
        const width = Math.min(PLACEHOLDER_WIDTH, rect.width);
        const height = Math.max(1, Math.round(width * rect.height / rect.width));
        const original = await this.#storage.get(`cms/files/${file.id}`);
        if (!original) return file;
        const { head, body } = await peek(original.body, Math.min(HEAD_BYTES, original.size || HEAD_BYTES));
        if (imageHasAlpha(file.contentType, head)) {
            await body.cancel().catch(() => undefined);
            if (file.placeholder) await this.#db.write([{ rql: "UPDATE cms_files SET placeholder = NULL WHERE id = $id AND status = 'ready'", params: { $id: file.id } }], WRITE);
            return { ...file, placeholder: null };
        }
        let placeholder: string;
        try {
            const bytes = await this.#images.transform(body, { rect, source: { width: file.width, height: file.height }, width, height, format: 'webp', quality: 40 });
            placeholder = `data:image/webp;base64,${base64(bytes)}`;
        } catch (error) {
            if (!this.#warned) console.warn('[cms] could not make image placeholders.', error);
            this.#warned = true;
            return file;
        }
        await this.#db.write([{ rql: "UPDATE cms_files SET placeholder = $placeholder WHERE id = $id AND status = 'ready'", params: { $placeholder: placeholder, $id: file.id } }], WRITE);
        return { ...file, placeholder };
    }

    /**
     * A resized variant of an image, made on first request and kept in storage: `width` snaps to
     * the site's widths and never exceeds the image; `height` crops to the requested shape, snapped
     * to one of `VARIANT_ASPECTS`, around the focal point. The format follows `accept`. Null when
     * the file is missing or cannot be resized.
     *
     * Every request maps to one of a finite set of variants (widths × shapes × formats), so a
     * visitor cannot make a file transform more than `MAX_FILE_VARIANTS` times: each variant is
     * made once and kept. Past the cap (only after the site's widths changed), the original is served.
     */
    async variant(id: string, request: { width: number; height?: number; accept?: string; signal?: AbortSignal }): Promise<{ file: CmsFile; body: ReadableStream<Uint8Array>; contentType: string; size: number } | null> {
        const file = await this.get(id);
        if (!file || !this.#images || !transformable(file.contentType) || !file.width || !file.height) return null;
        if (!Number.isSafeInteger(request.width) || request.width < 1 || (request.height !== undefined && (!Number.isSafeInteger(request.height) || request.height < 1 || request.height > 10_000))) return null;
        const settings = await this.#imageSettings();
        // The shape asked for (the icons ask for squares) snaps to a short list of common shapes.
        const aspect = request.height ? snapAspect(request.width / request.height) : undefined;
        const rect = variantRect(file, aspect)!;
        const width = Math.min(variantWidth(request.width, settings.widths), rect.width);
        const height = Math.max(1, Math.round(width * rect.height / rect.width));
        const format = negotiateFormat(request.accept, file.contentType);
        // Keyed on the image's content and edits, not its version: a new title or alt text makes no new variants.
        const key = `cms/variants/${id}/${editsKey(file.edits)}/${width}x${height}${request.height ? 'c' : ''}.${format}`;
        const contentType = FORMAT_TYPES[format];
        const stored = await this.#storage.get(key, request.signal ? { signal: request.signal } : {});
        if (stored) return { file, body: stored.body, contentType, size: stored.size };
        let making = this.#making.get(key);
        if (!making) {
            making = this.#makeVariant(file, key, { rect, width, height, format, contentType, quality: format === 'avif' ? Math.max(30, settings.quality - 18) : settings.quality })
                .finally(() => this.#making.delete(key));
            this.#making.set(key, making);
        }
        const bytes = await making;
        return bytes ? { file, body: streamOf(bytes), contentType, size: bytes.byteLength } : null;
    }

    /**
     * Make and keep one variant. The variants a file can have are a finite set, so a file never
     * holds more than `MAX_FILE_VARIANTS`; the count check below only matters once the site's
     * widths changed and left the old widths' variants behind: then the original is served.
     */
    async #makeVariant(file: CmsFile, key: string, shape: { rect: { x: number; y: number; width: number; height: number }; width: number; height: number; format: ImageFormat; contentType: string; quality: number }): Promise<Uint8Array | null> {
        const kept = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_file_variants WHERE file_id = $id', params: { $id: file.id } }]);
        if (Number(kept.results[0]!.rows[0]![0] ?? 0) >= MAX_FILE_VARIANTS) return null;
        const original = await this.#storage.get(`cms/files/${file.id}`);
        if (!original) return null;
        let bytes: Uint8Array;
        try {
            bytes = await this.#images!.transform(original.body, { rect: shape.rect, source: { width: file.width!, height: file.height! }, width: shape.width, height: shape.height, format: shape.format, quality: shape.quality });
        } catch (error) {
            // A transformer that cannot run, such as sharp missing on Node, leaves the original.
            if (!this.#warned) console.warn('[cms] could not resize images; serving originals.', error);
            this.#warned = true;
            return null;
        }
        await this.#db.write([{ rql: 'INSERT INTO cms_file_variants (key, file_id, created_at, size) VALUES ($key, $id, $now, $size) ON CONFLICT (key) DO NOTHING', params: { $key: key, $id: file.id, $now: this.#now(), $size: bytes.byteLength } }], WRITE);
        await this.#storage.put(key, streamOf(bytes), { size: bytes.byteLength, contentType: shape.contentType });
        return bytes;
    }

    /** Remove the file's variants, a page at a time: each row goes only with its stored object. */
    async #dropVariants(id: string): Promise<void> {
        for (;;) {
            const result = await this.#db.read([{ rql: 'SELECT key FROM cms_file_variants WHERE file_id = $id ORDER BY key LIMIT 500', params: { $id: id } }]);
            const keys = result.results[0]!.rows.map(row => row[0] as string);
            if (!keys.length) return;
            await this.#evictVariants(id, keys);
            if (keys.length < 500) return;
        }
    }

    /** Delete these variant rows of a file, with their stored objects: only keys under the file's own variant prefix are deleted from storage. */
    async #evictVariants(id: string, keys: readonly string[]): Promise<void> {
        if (!keys.length) return;
        for (const key of keys) if (isVariantKey(key, id)) await this.#storage.delete(key).catch(() => undefined);
        const params: { [name: string]: string } = { $id: id };
        keys.forEach((key, index) => { params[`$k${index}`] = key; });
        await this.#db.write([{ rql: `DELETE FROM cms_file_variants WHERE file_id = $id AND key IN (${keys.map((_, index) => `$k${index}`).join(', ')})`, params }], WRITE);
    }

    /**
     * Record intent, store the bytes, then mark the file ready. The declared type must match
     * the file's signature; image dimensions are read from its first bytes; SVG is sanitized.
     */
    async upload(file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> } & FileMetadata,
        context: { principal: Principal; signal?: AbortSignal; maxBytes?: number; owner?: string }): Promise<CmsFile> {
        const { id, contentType, size, head } = await this.#store(file, context, 'cms/files/');
        return this.#placeholder(await this.#shrink(await this.#ready(id, size, imageSize(contentType, head))));
    }

    /** Begin an upload under a key prefix, check its signature and store its bytes; the row stays pending. */
    async #store(file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> } & FileMetadata,
        context: { principal: Principal; signal?: AbortSignal; maxBytes?: number; owner?: string }, prefix: string): Promise<{ id: string; name: string; contentType: string; size: number; head: Uint8Array }> {
        const { id, key, name, contentType } = await this.#begin(file, context, prefix);
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
        return { id, name, contentType, size, head };
    }

    // --- Private files ----------------------------------------------------------------------

    /**
     * Store a private file under `cms/private/<scope>/`, checked as an upload is (size, type,
     * signature, SVG sanitized). Its row stays pending: the caller's own write makes it ready
     * with `privateReady`, in the same batch as what the file belongs to, and `sweep()` removes
     * it when that write never happens. The principal is the host's; `owner` names the sender.
     */
    async stashPrivate(file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> },
        context: { principal: Principal; scope: string; signal?: AbortSignal; maxBytes?: number; owner?: string }): Promise<{ id: string; name: string; contentType: string; size: number }> {
        if (!SCOPE.test(context.scope)) throw new Error(`Invalid private file scope ${context.scope}.`);
        const { head: _head, ...stored } = await this.#store(file, context, `${PRIVATE_PREFIX}${context.scope}/`);
        return stored;
    }

    /** The statement that makes stashed private files ready, for the caller's batch: it applies only when `guard` (a condition with its params) holds. */
    privateReady(ids: readonly string[], guard: { readonly rql: string; readonly params: { readonly [key: string]: Value } }): Statement {
        const params: { [key: string]: Value } = { ...guard.params, $readyAt: this.#now() };
        const list = ids.map((id, index) => { params[`$ready${index}`] = id; return `$ready${index}`; }).join(', ');
        return { rql: `UPDATE cms_files SET status = 'ready', updated_at = $readyAt WHERE status = 'pending' AND key LIKE '${PRIVATE_PREFIX}%' AND id IN (${list}) AND ${guard.rql}`, params };
    }

    /** A ready private file of a scope with its bytes, or null. The caller has checked who may read it. */
    async openPrivate(scope: string, id: string, options: { signal?: AbortSignal } = {}): Promise<{ file: CmsFile; body: ReadableStream<Uint8Array> } | null> {
        if (!SCOPE.test(scope) || !ID.test(id)) return null;
        const key = `${PRIVATE_PREFIX}${scope}/${id}`;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_files WHERE id = $id AND key = $key AND status = 'ready'`, params: { $id: id, $key: key } }]);
        const row = result.results[0]!.rows[0];
        if (!row) return null;
        const object = await this.#storage.get(key, options);
        return object ? { file: fileOf(row), body: object.body } : null;
    }

    /** Remove stashed private files no write made ready, such as those of a refused submission. */
    async discardPrivate(ids: readonly string[]): Promise<void> {
        for (const id of ids) {
            const marked = await this.#db.write([{ rql: `UPDATE cms_files SET status = 'deleting', updated_at = $now WHERE id = $id AND status = 'pending' AND key LIKE '${PRIVATE_PREFIX}%'`, params: { $id: id, $now: this.#now() } }], WRITE);
            if (marked.results[0]!.affected === 1n) await this.#finishDelete(id);
        }
    }

    /**
     * Delete every private file under a scope, ready or pending, such as a submission's
     * (`forms/<form>/<submission>`) or a whole form's (`forms/<form>`). Returns how many.
     * Keys are matched as a range, so the key index finds them.
     */
    async deletePrivate(scope: string): Promise<number> {
        if (!SCOPE.test(scope)) throw new Error(`Invalid private file scope ${scope}.`);
        // Every key under `<prefix>/` sorts at or after it and before `<prefix>0`: '0' follows '/'.
        const range = { $from: `${PRIVATE_PREFIX}${scope}/`, $to: `${PRIVATE_PREFIX}${scope}0` };
        let removed = 0;
        for (;;) {
            const found = await this.#db.read([{ rql: "SELECT id FROM cms_files WHERE key >= $from AND key < $to AND status IN ('pending', 'ready') LIMIT 200", params: range }]);
            const ids = found.results[0]!.rows.map(row => row[0] as string);
            for (const id of ids) {
                const marked = await this.#db.write([{ rql: "UPDATE cms_files SET status = 'deleting', updated_at = $now WHERE id = $id AND status IN ('pending', 'ready') AND key >= $from AND key < $to", params: { ...range, $id: id, $now: this.#now() } }], WRITE);
                if (marked.results[0]!.affected !== 1n) continue;
                await this.#finishDelete(id);
                removed++;
            }
            if (ids.length < 200) break;
        }
        return removed;
    }

    /**
     * Start an upload the browser sends itself. The row records intent; the bytes go to
     * `direct` (the bucket's presigned URL) or through `receive()`; `complete()` checks them
     * and makes the file. Stale uploads that never complete are swept.
     */
    async begin(file: { name: string; contentType: string; size: number } & FileMetadata, context: { principal: Principal; maxBytes?: number; owner?: string }): Promise<PendingUpload> {
        const { id, name, contentType } = await this.#begin(file, context);
        let direct: StoragePresignedUpload | null = null;
        if (this.#storage.presign) {
            // The browser writes a staging object; the served one is written by complete() alone, from the bytes it checked.
            try { direct = await this.#storage.presign(stagingKey(id), { size: file.size, contentType, expiresIn: this.#presignSeconds }); }
            catch { direct = null; }
        }
        return { id, name, contentType, size: file.size, direct };
    }

    /** Store the bytes of an upload the browser sends through the application, as begun. */
    async receive(id: string, body: ReadableStream<Uint8Array>, context: { principal: Principal; signal?: AbortSignal }): Promise<void> {
        const pending = await this.#pending(id, context.principal);
        await this.#storage.put(stagingKey(id), body, { size: pending.size, contentType: pending.contentType, ...(context.signal ? { signal: context.signal } : {}) });
    }

    /**
     * Finish an upload: the staging object must exist with the declared size and a matching
     * signature. The served key gets only the bytes this read checked (SVG sanitized), so bytes
     * sent to the staging key later, through a presigned URL still valid or a late request,
     * never reach it; the staging object is removed. A failed check removes both.
     */
    async complete(id: string, context: { principal: Principal; signal?: AbortSignal }): Promise<CmsFile> {
        const pending = await this.#pending(id, context.principal);
        const signal = context.signal ? { signal: context.signal } : {};
        const staging = stagingKey(id);
        const refuse = async (message: string) => { await this.#abandon(id); return new CmsError('CMS_VALIDATION', message); };
        const object = await this.#storage.get(staging, signal);
        if (!object) throw await refuse('The upload did not finish.');
        if (object.size !== pending.size) {
            await object.body.cancel().catch(() => undefined);
            throw await refuse(`The upload has ${object.size} bytes, not the ${pending.size} declared.`);
        }
        const { head, body } = await peek(object.body, Math.min(HEAD_BYTES, pending.size));
        if (!matchesSignature(pending.contentType, head)) {
            await body.cancel().catch(() => undefined);
            throw await refuse(`The file is not a valid ${pending.contentType} file.`);
        }
        let size = pending.size;
        try {
            if (pending.contentType === SVG_TYPE) {
                const clean = await this.#cleanSvg(id, body, pending.size);
                size = clean.byteLength;
                await this.#storage.put(pending.key, streamOf(clean), { size, contentType: pending.contentType, ...signal });
            } else await this.#storage.put(pending.key, body, { size, contentType: pending.contentType, ...signal });
        } catch (error) {
            if (!(error instanceof CmsError)) await this.#abandon(id).catch(() => undefined);
            throw error;
        }
        await this.#storage.delete(staging).catch(() => undefined);
        return this.#placeholder(await this.#shrink(await this.#ready(id, size, imageSize(pending.contentType, head))));
    }

    /** Check the upload and record intent; the row is pending until the bytes are in. */
    async #begin(file: { name: string; contentType: string; size: number } & FileMetadata, context: { principal: Principal; maxBytes?: number; owner?: string }, prefix = 'cms/files/'): Promise<{ id: string; key: string; name: string; contentType: string }> {
        if (!hasPermission(context.principal, PERMISSIONS.upload) && !hasPermission(context.principal, PERMISSIONS.manageMedia)) {
            throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to upload files.');
        }
        const maxBytes = Math.min(context.maxBytes ?? this.#maxBytes, this.#maxBytes);
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) throw new CmsError('CMS_LIMIT', maxBytes === Number.MAX_SAFE_INTEGER ? 'Files must be at least 1 byte.' : `Files must be 1 byte to ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
        const contentType = declaredType(file.contentType);
        if (this.#types && !this.#types.includes(contentType)) throw new CmsError('CMS_VALIDATION', `Files of type ${contentType} are not accepted.`);
        if (contentType === SVG_TYPE && file.size > SVG_MAX_BYTES) throw new CmsError('CMS_LIMIT', `SVG files must be at most ${SVG_MAX_BYTES / 1024 / 1024} MB.`);
        const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200) || 'file';
        const id = uuidv7();
        const key = `${prefix}${id}`;
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
        const result = await this.#db.read([{ rql: `SELECT key, owner_id, content_type, size FROM cms_files WHERE id = $id AND status = 'pending' AND ${LIBRARY_KEYS}`, params: { $id: id } }]);
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
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_files WHERE id = $id AND status = 'ready' AND ${LIBRARY_KEYS}`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? fileOf(row) : null;
    }

    async getMany(ids: readonly string[]): Promise<Map<string, CmsFile>> {
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 200);
        if (!wanted.length) return new Map();
        // Files hold captions, descriptions, edits and a placeholder: many may come in smaller reads.
        const rows = await readByIds(this.#db, wanted, slice => ({
            rql: `SELECT ${COLUMNS} FROM cms_files WHERE status = 'ready' AND ${LIBRARY_KEYS} AND id IN (${slice.map((_, index) => `$f${index}`).join(', ')})`,
            params: Object.fromEntries(slice.map((id, index) => [`$f${index}`, id])),
        }));
        return new Map(rows.map(row => { const file = fileOf(row); return [file.id, file]; }));
    }

    /** Ready files, newest first, filtered by kind, owner and a search over name and title. */
    async list(options: { kind?: MediaKind; search?: string; owner?: string; limit?: number; offset?: number } = {}): Promise<{ items: CmsFile[]; total: number }> {
        const conditions = ["status = 'ready'", LIBRARY_KEYS];
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
        const counted = await this.#db.read([Object.keys(params).length ? { rql: `SELECT count(*) FROM cms_files WHERE ${where}`, params } : { rql: `SELECT count(*) FROM cms_files WHERE ${where}` }]);
        const rows = await readPaged(this.#db, (size, at) => ({ rql: `SELECT ${COLUMNS} FROM cms_files WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset`, params: { ...params, $limit: size, $offset: at } }),
            Math.min(Math.max(options.limit ?? 40, 1), 100), Math.min(Math.max(options.offset ?? 0, 0), 100_000), { afterSequence: counted.sequence });
        return { items: rows.map(fileOf), total: Number(counted.results[0]!.rows[0]![0] as bigint) };
    }

    /** Change title, alt text, caption or description. The owner or a media manager may edit. */
    async update(id: string, patch: FileMetadata, context: { principal: Principal }): Promise<CmsFile> {
        const file = await this.get(id);
        if (!file) throw new CmsError('CMS_NOT_FOUND', 'File not found.');
        this.#authorizeChange(file, context.principal, 'edit');
        const next = checkMetadata({ title: patch.title ?? file.title, alt: patch.alt ?? file.alt, caption: patch.caption ?? file.caption, description: patch.description ?? file.description });
        await this.#db.write([{ rql: "UPDATE cms_files SET title = $title, alt = $alt, caption = $caption, description = $description, updated_at = $now WHERE id = $id AND status = 'ready'",
            params: { ...prefixed(next), $now: this.#now(), $id: id } }], WRITE);
        await this.#changed?.();
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
        await this.#changed?.();
    }

    /** Resolve interrupted work: stale pending uploads are removed; stale deletes are completed. */
    /** Delete every stored file and resized copy, for a site that is being deleted. The rows stay. */
    async purgeStorage(): Promise<number> {
        let removed = 0;
        // Only keys the service gives files and variants: a row from an imported export cannot name another object.
        for (const [table, id] of [['cms_files', 'id'], ['cms_file_variants', 'file_id']] as const) {
            let after = '';
            for (;;) {
                const result = await this.#db.read([{ rql: `SELECT key, ${id} FROM ${table} WHERE key > $after ORDER BY key LIMIT 500`, params: { $after: after } }]);
                const rows = result.results[0]!.rows.map(row => [row[0] as string, row[1] as string] as const);
                for (const [key, owner] of rows) {
                    if (!(table === 'cms_files' ? isFileKey(key, owner) : isVariantKey(key, owner))) continue;
                    await this.#storage.delete(key);
                    removed++;
                }
                if (rows.length < 500) break;
                after = rows[rows.length - 1]![0];
            }
        }
        return removed;
    }

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
        // The row names its key: a library file's, or a private one's.
        const row = await this.#db.read([{ rql: 'SELECT key FROM cms_files WHERE id = $id', params: { $id: id } }]);
        const key = row.results[0]!.rows[0]?.[0];
        await this.#dropVariants(id);
        // Only a key the service gives a file: a row from an imported export cannot name another object.
        await this.#storage.delete(typeof key === 'string' && isFileKey(key, id) ? key : `cms/files/${id}`);
        // A browser upload that never finished left its bytes in staging.
        await this.#storage.delete(stagingKey(id)).catch(() => undefined);
        await this.#db.write([{ rql: "DELETE FROM cms_files WHERE id = $id AND status = 'deleting'", params: { $id: id } }], WRITE);
    }
}

/** A key the service gives file `id`: its library key, or a private one ending in its ID. */
function isFileKey(key: string, id: string): boolean {
    return key === `cms/files/${id}` || (key.startsWith(PRIVATE_PREFIX) && !key.includes('..') && key.endsWith(`/${id}`));
}

/** A key under file `id`'s own variant prefix. */
function isVariantKey(key: string, id: string): boolean {
    return key.startsWith(`cms/variants/${id}/`) && !key.includes('..');
}

/** Where a browser upload's bytes wait for complete(): never a served key, and never written to after it. */
function stagingKey(id: string): string {
    return `cms/uploads/${id}`;
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
        placeholder: typeof row[14] === 'string' && row[14] ? row[14] : null,
        createdAt: Number(row[11] as bigint), updatedAt: Number(row[12] as bigint),
    });
}

function base64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function parseEdits(text: string): ImageEdits | null {
    try { return JSON.parse(text) as ImageEdits; } catch { return null; }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

/** The shapes variants are cut to: square, and 4:3, 3:2, 16:9 and 21:9 either way up. */
export const VARIANT_ASPECTS = Object.freeze([1, 4 / 3, 3 / 4, 3 / 2, 2 / 3, 16 / 9, 9 / 16, 21 / 9, 9 / 21] as const);

/**
 * The most variants one file has: up to 12 widths (Settings → Files) × the whole image and each
 * shape × 3 formats. Every request maps to one of these, so this bound holds by construction.
 */
export const MAX_FILE_VARIANTS = 12 * (1 + VARIANT_ASPECTS.length) * 3;

/** A short, stable name for an image's edits (crop and focus), for its variants' keys. */
function editsKey(edits: ImageEdits | null | undefined): string {
    if (!edits) return 'o';
    const text = JSON.stringify([edits.crop?.x, edits.crop?.y, edits.crop?.width, edits.crop?.height, edits.focus?.x, edits.focus?.y]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(36);
}

/** A requested shape, snapped to the nearest of `VARIANT_ASPECTS` (by ratio, so wide and tall weigh alike). */
export function snapAspect(aspect: number): number {
    if (!Number.isFinite(aspect) || aspect <= 0) return 1;
    let best: number = VARIANT_ASPECTS[0];
    for (const shape of VARIANT_ASPECTS) if (Math.abs(Math.log(shape / aspect)) < Math.abs(Math.log(best / aspect)) - 1e-12) best = shape;
    return best;
}
