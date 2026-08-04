import * as fs from 'fs';
import * as path from 'path';
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

/**
 * Create a middleware that serves static files from a directory.
 * This is for Node.js runtime only - uses fs to read files.
 *
 * @param options - Static serving options
 * @returns Hono middleware
 */
export function serveStatic(options: StaticServeOptions) {
    const { root, prefix = '/', index = true, cacheControl } = options;
    // Resolve root once; every served path must resolve to within it.
    const resolvedRoot = path.resolve(root);
    const rootPrefix = resolvedRoot + path.sep;

    const containsRoot = (filePath: string): boolean => {
        const resolved = path.resolve(filePath);
        return resolved === resolvedRoot || resolved.startsWith(rootPrefix);
    };

    return async (c: Context, next: Next) => {
        // Only handle GET requests
        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
            return next();
        }

        const urlPath = normalizeUrlPath(c.req.path);

        // Check if the path matches our prefix
        if (!urlPath.startsWith(prefix)) {
            return next();
        }

        // Get the file path relative to the prefix
        let relativePath = urlPath.substring(prefix.length);
        if (relativePath === '') relativePath = '/';

        // Build full file path
        let filePath: string;
        if (relativePath === '/') {
            if (!index) return next();
            filePath = path.join(root, 'index.html');
        } else {
            // Try direct file first
            filePath = path.join(root, relativePath);

            // If it doesn't exist and index is enabled, try index.html
            if (index && !fs.existsSync(filePath)) {
                const indexPath = path.join(filePath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    filePath = indexPath;
                }
            }
        }

        // SECURITY: refuse any path that escapes the configured root (e.g.
        // `/../etc/passwd` or encoded variants). Treat as a 404 (next()) rather
        // than 403 to avoid confirming the existence of files outside root.
        if (!containsRoot(filePath)) {
            return next();
        }

        // Check if file exists and is not a directory
        try {
            let stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) {
                if (index) {
                    const indexPath = path.join(filePath, 'index.html');
                    try {
                        await fs.promises.access(indexPath);
                        filePath = indexPath;
                        stats = await fs.promises.stat(filePath);
                    } catch {
                        return next();
                    }
                } else {
                    return next();
                }
            }

            // Read (as a Buffer so binary assets aren't corrupted) and serve
            // with the correct Content-Type. Previously c.html() forced
            // text/html for every asset (CSS, JS, images, fonts).
            const content = await fs.promises.readFile(filePath);
            const contentType = getContentType(filePath);
            const headers = new Headers({ 'Content-Type': contentType });
            const resolvedCacheControl = typeof cacheControl === 'function'
                ? cacheControl(filePath, urlPath)
                : cacheControl;
            if (resolvedCacheControl) headers.set('Cache-Control', resolvedCacheControl);

            return new Response(new Uint8Array(content), {
                status: 200,
                headers,
            });
        } catch (e) {
            // File doesn't exist or other error
            return next();
        }
    };
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
