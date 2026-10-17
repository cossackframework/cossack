/** Redirects: their shape and validation. Client-safe; the host stores and matches them. */
export const REDIRECT_STATUSES = Object.freeze([301, 302, 307, 308, 410] as const);
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

export interface Redirect {
    readonly id: string;
    /** A path, or a prefix ending in `/*`. */
    readonly source: string;
    /** A path or an absolute URL; a prefix target can end in `/*` to keep the rest. Empty for 410. */
    readonly target: string;
    readonly status: RedirectStatus;
    readonly prefix: boolean;
    /** Recorded by the host when a URL changed, or made by a person. */
    readonly kind: 'auto' | 'manual';
    readonly note: string;
    readonly hits: number;
    readonly lastHitAt: number | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RedirectInput {
    readonly source: string;
    readonly target: string;
    readonly status?: RedirectStatus;
    readonly note?: string;
}

/** A path a redirect can start from. */
export const REDIRECT_PATH = /^\/[^\s?#]{0,499}$/;
const PATH = REDIRECT_PATH;
const URL_TARGET = /^https?:\/\/[^\s]{1,2000}$/;

/** A request path without its trailing slash, as sources are stored. */
export function redirectPath(path: string): string {
    const clean = path.split(/[?#]/)[0]!;
    return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

/** Problems with a redirect; empty when valid. */
export function redirectProblems(input: RedirectInput): string[] {
    const problems: string[] = [];
    const status = input.status ?? 301;
    const source = typeof input.source === 'string' ? redirectPath(input.source.trim()) : '';
    const prefix = source.endsWith('/*');
    if (!PATH.test(source) || source === '/' || source === '/*' || (source.includes('*') && !prefix) || source.slice(0, -2).includes('*')) {
        problems.push('The source is a path such as /old-page, or a prefix such as /old/*.');
    }
    if (!REDIRECT_STATUSES.includes(status)) problems.push('The type is 301, 302, 307, 308 or 410.');
    const target = typeof input.target === 'string' ? input.target.trim() : '';
    if (status !== 410) {
        if (!(PATH.test(target) || URL_TARGET.test(target)) || (target.includes('*') && !(prefix && target.endsWith('/*') && !target.slice(0, -2).includes('*')))) {
            problems.push('The target is a path such as /new-page or a full URL; a prefix target can end in /*.');
        } else if (redirectPath(target) === source) problems.push('The target is the source.');
    }
    if (typeof input.note === 'string' && input.note.length > 200) problems.push('The note can be at most 200 characters.');
    return problems;
}
