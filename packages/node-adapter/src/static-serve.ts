import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';

/**
 * Options for static file serving middleware
 */
export interface StaticServeOptions {
    /** Root directory for static files */
    root: string;
    /** URL path prefix to serve files from (default: '/') */
    prefix?: string;
    /** Whether to try index.html for directory requests (default: true) */
    index?: boolean;
    /** Cache-Control value, or a resolver based on the matched file and URL. */
    cacheControl?: string | ((filePath: string, urlPath: string) => string | undefined);
}

/**
 * Normalize a URL path for file system operations.
 * Handles query strings, hashes, and trailing slashes.
 */
function normalizeUrlPath(urlPath: string): string {
    let normalizedPath = urlPath;

    // Remove query string and hash
    const queryIndex = normalizedPath.indexOf('?');
    if (queryIndex !== -1) {
        normalizedPath = normalizedPath.substring(0, queryIndex);
    }
    const hashIndex = normalizedPath.indexOf('#');
    if (hashIndex !== -1) {
        normalizedPath = normalizedPath.substring(0, hashIndex);
    }

    // Ensure it starts with /
    if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
    }

    // Remove trailing slash (except for root)
    if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
        normalizedPath = normalizedPath.slice(0, -1);
    }

    return normalizedPath;
}

/** Normalize a configured prefix to `/` or `/segment[/segment...]` without a trailing slash. */
function normalizePrefix(prefix: string): string {
    let normalized = prefix.startsWith('/') ? prefix : '/' + prefix;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

/** Weak validator: the bytes are not hashed, so equal mtime and size count as equal. */
function weakEtag(stats: fs.Stats): string {
    return `W/"${Math.floor(stats.mtimeMs).toString(16)}-${stats.size.toString(16)}"`;
}

/** `If-None-Match` uses weak comparison (RFC 9110 §13.1.2). */
function matchesIfNoneMatch(header: string, etag: string): boolean {
    const opaque = etag.replace(/^W\//, '');
    return header.split(',').some(candidate => {
        const value = candidate.trim();
        return value === '*' || value.replace(/^W\//, '') === opaque;
    });
}

/** Parse an HTTP-date; future dates are invalid (RFC 9110 §13.1.3). */
function pastDate(value: string | undefined, now: number): number | undefined {
    const date = value ? Date.parse(value) : NaN;
    return Number.isFinite(date) && date <= now ? date : undefined;
}

/**
 * RFC 9110 §13.2.2: `If-None-Match` takes precedence; `If-Modified-Since` is
 * evaluated only without it. Both apply to GET and HEAD.
 */
function notModified(c: Context, etag: string, lastModified: number, now: number): boolean {
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch) return matchesIfNoneMatch(ifNoneMatch, etag);
    const since = pastDate(c.req.header('if-modified-since'), now);
    return since !== undefined && lastModified <= since;
}

type ByteRange = { start: number; end: number };

/**
 * One `bytes=first-last`, `bytes=first-` or `bytes=-suffix` range (RFC 9110 §14.1.2).
 * Returns `undefined` to ignore the header and send the whole file (absent,
 * malformed, another unit, or several ranges) and `null` when unsatisfiable.
 */
function parseRange(header: string | undefined, size: number): ByteRange | null | undefined {
    if (!header) return undefined;
    const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
    if (!match || (!match[1] && !match[2])) return undefined;
    const [, first, last] = match;
    if (!first) {
        const suffix = Number(last);
        return suffix === 0 || size === 0 ? null : { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(first), end = last ? Number(last) : Infinity;
    if (end < start) return undefined;
    return start >= size ? null : { start, end: Math.min(end, size - 1) };
}

/**
 * `If-Range` (RFC 9110 §13.1.5) needs a strong validator. The weak ETag never
 * matches; a date matches only if it equals a Last-Modified at least one second old.
 */
function rangeStillApplies(ifRange: string | undefined, lastModified: number, now: number): boolean {
    if (ifRange === undefined) return true;
    const value = ifRange.trim();
    if (value.startsWith('"') || value.startsWith('W/')) return false;
    return pastDate(value, now) === lastModified && now - lastModified >= 1000;
}

/**
 * Create a middleware that serves static files from a directory.
 * This is for Node.js runtime only - uses fs to read files.
 *
 * Files are streamed. Responses carry a weak `ETag`, `Last-Modified` and
 * `Accept-Ranges: bytes`; `If-None-Match`/`If-Modified-Since` return 304, and a
 * single `Range` on GET returns 206 (416 when unsatisfiable). Several ranges
 * receive the whole file with 200.
 *
 * @param options - Static serving options
 * @returns Hono middleware
 */
export function serveStatic(options: StaticServeOptions) {
    const { root, index = true, cacheControl } = options;
    const prefix = normalizePrefix(options.prefix ?? '/');
    // Resolve root once; every served path must resolve to within it.
    const resolvedRoot = path.resolve(root);
    const rootPrefix = resolvedRoot + path.sep;

    const containsRoot = (filePath: string): boolean => {
        const resolved = path.resolve(filePath);
        return resolved === resolvedRoot || resolved.startsWith(rootPrefix);
    };

    return async (c: Context, next: Next) => {
        const method = c.req.method;
        if (method !== 'GET' && method !== 'HEAD') {
            return next();
        }

        const urlPath = normalizeUrlPath(c.req.path);

        // Match whole path segments: `/assets` must not serve `/assets-x`.
        let relativePath: string;
        if (prefix === '/') relativePath = urlPath;
        else if (urlPath === prefix) relativePath = '/';
        else if (urlPath.startsWith(prefix + '/')) relativePath = urlPath.slice(prefix.length);
        else return next();

        let filePath: string;
        if (relativePath === '/') {
            if (!index) return next();
            filePath = path.join(root, 'index.html');
        } else {
            filePath = path.join(root, relativePath);
        }

        // SECURITY: refuse any path that escapes the configured root (e.g.
        // `/../etc/passwd` or encoded variants). Treat as a 404 (next()) rather
        // than 403 to avoid confirming the existence of files outside root.
        if (!containsRoot(filePath)) {
            return next();
        }

        let file: fs.promises.FileHandle | undefined;
        try {
            let stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) {
                if (!index) return next();
                filePath = path.join(filePath, 'index.html');
                stats = await fs.promises.stat(filePath);
            }

            // Lexical containment does not stop a symlink inside the public
            // directory from exposing files outside it (including index.html).
            const [realRoot, realFile] = await Promise.all([
                fs.promises.realpath(resolvedRoot),
                fs.promises.realpath(filePath),
            ]);
            const relative = path.relative(realRoot, realFile);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return next();
            if (!stats.isFile()) return next();

            // Describe the bytes actually sent: take size and validator from the open file.
            if (method === 'GET') {
                file = await fs.promises.open(realFile, 'r');
                stats = await file.stat();
                if (!stats.isFile()) return next();
            }

            const now = Date.now();
            const etag = weakEtag(stats);
            // HTTP dates have one-second precision and must not be in the future.
            const lastModified = Math.min(Math.floor(stats.mtimeMs / 1000), Math.floor(now / 1000)) * 1000;
            const headers = new Headers({ ETag: etag });
            const resolvedCacheControl = typeof cacheControl === 'function'
                ? cacheControl(filePath, urlPath)
                : cacheControl;
            if (resolvedCacheControl) headers.set('Cache-Control', resolvedCacheControl);

            if (notModified(c, etag, lastModified, now)) {
                return new Response(null, { status: 304, headers });
            }
            headers.set('Last-Modified', new Date(lastModified).toUTCString());
            headers.set('Accept-Ranges', 'bytes');

            // Range handling is defined only for GET (RFC 9110 §14.2); HEAD describes the whole file.
            const range = method === 'GET' && rangeStillApplies(c.req.header('if-range'), lastModified, now)
                ? parseRange(c.req.header('range'), stats.size)
                : undefined;
            if (range === null) {
                return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stats.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': '0' } });
            }

            // Serve with the correct Content-Type. Previously c.html() forced
            // text/html for every asset (CSS, JS, images, fonts).
            headers.set('Content-Type', getContentType(filePath));
            const start = range?.start ?? 0, end = range?.end ?? stats.size - 1;
            const status = range ? 206 : 200;
            if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            headers.set('Content-Length', String(end - start + 1));
            if (!file || stats.size === 0) return new Response(null, { status, headers });

            // Stream instead of buffering. `end` (inclusive) caps the body at the
            // advertised length; the stream owns and closes the handle from here.
            const stream = file.createReadStream({ start, end, autoClose: true });
            file = undefined;
            return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers });
        } catch {
            // File doesn't exist or other error
            return next();
        } finally {
            await file?.close().catch(() => {});
        }
    };
}

/** Filesystem-backed ASSETS binding for SSR manifest and CSS reads. */
export function createStaticAssets(options: StaticServeOptions): { fetch(request: Request): Promise<Response> } {
    const app = new Hono();
    app.use('*', serveStatic(options));
    return { fetch: async request => app.fetch(request) };
}

/**
 * Get the content type for a file based on its extension.
 */
function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.cjs': 'application/javascript',
        '.json': 'application/json',
        '.map': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.xml': 'application/xml',
        '.txt': 'text/plain',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
    };

    return contentTypes[ext] || 'application/octet-stream';
}
