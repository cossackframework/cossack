/**
 * The update notice (specs/cms-updates.md). The CMS asks an update server which version is the
 * latest. The request carries the installed version and the channel, and nothing about the
 * site. The answer only informs: code always comes from the package registry through the
 * project's own pipeline.
 */
export const DEFAULT_UPDATES_URL = 'https://cms.cossack.dev/update';
export const DEFAULT_UPDATES_CHANNEL = 'latest';

/** `updates` in `src/cms.config.ts`. */
export interface UpdatesOptions {
    /** Ask the update server once a day. Default true. */
    readonly check?: boolean;
    /** The update server. */
    readonly url?: string;
    /** The release channel: `latest`, or a pre-release channel such as `canary`. */
    readonly channel?: string;
}

/** What the update server said, when it named a version newer than the installed one. */
export interface UpdateAnswer {
    readonly latest: string;
    /** When the version was published, as an ISO date. */
    readonly published?: string;
    /** The release notes. */
    readonly notes?: string;
    /** A release between the installed version and `latest` fixes a security problem. */
    readonly security: boolean;
    /** The scaffold template the latest version needs: the update also changes project files. */
    readonly hostTemplate?: string;
    /** The oldest version that can go to `latest` in one step. */
    readonly minimumFrom?: string;
}

/** The last check, as the site stores it. */
export interface UpdateCheck {
    readonly checkedAt: number;
    readonly installed: string;
    readonly channel: string;
    /** Null when the installed version is the latest, or when no check has answered yet. */
    readonly available: UpdateAnswer | null;
    /** Why the last check did not answer. The earlier answer is kept. */
    readonly error?: string;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Order two versions: negative when `a` is older. A pre-release is older than its release. Null for a text that is no version. */
export function compareVersions(a: string, b: string): number | null {
    const left = VERSION.exec(a), right = VERSION.exec(b);
    if (!left || !right) return null;
    for (let index = 1; index <= 3; index++) {
        const difference = Number(left[index]) - Number(right[index]);
        if (difference) return difference;
    }
    if (left[4] === right[4]) return 0;
    if (left[4] === undefined) return 1;
    if (right[4] === undefined) return -1;
    const parts = [left[4].split('.'), right[4].split('.')] as const;
    for (let index = 0; index < Math.max(parts[0].length, parts[1].length); index++) {
        const [x, y] = [parts[0][index], parts[1][index]];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        if (x === y) continue;
        const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
        return numeric ? Number(x) - Number(y) : x < y ? -1 : 1;
    }
    return 0;
}

const text = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;
const httpUrl = (value: unknown): string | undefined => {
    const candidate = text(value, 500);
    if (!candidate) return undefined;
    try { const url = new URL(candidate); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined; }
    catch { return undefined; }
};

/**
 * The server's answer, checked: a valid version newer than the installed one, or null. A wrong
 * answer can then show at most a wrong notice.
 */
export function parseUpdateAnswer(body: unknown, installed: string): UpdateAnswer | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const answer = body as Record<string, unknown>;
    const latest = text(answer.latest, 64);
    if (!latest || !((compareVersions(latest, installed) ?? 0) > 0)) return null;
    const version = (value: unknown) => { const candidate = text(value, 64); return candidate && compareVersions(candidate, candidate) === 0 ? candidate : undefined; };
    const published = text(answer.published, 40);
    const notes = httpUrl(answer.notes), hostTemplate = version(answer.hostTemplate), minimumFrom = version(answer.minimumFrom);
    return {
        latest, security: answer.security === true,
        ...(published && !Number.isNaN(Date.parse(published)) ? { published } : {}),
        ...(notes ? { notes } : {}), ...(hostTemplate ? { hostTemplate } : {}), ...(minimumFrom ? { minimumFrom } : {}),
    };
}

/** The request: the installed version and the channel, and nothing else. */
export function updateCheckUrl(options: { url: string; channel: string }, installed: string): string {
    const url = new URL(options.url);
    url.searchParams.set('version', installed);
    url.searchParams.set('channel', options.channel);
    return url.toString();
}

/**
 * Ask the update server. A failed check (the server is down, the answer is not JSON) keeps
 * `previous`'s answer and records the reason.
 */
export async function checkForUpdate(options: {
    installed: string; url: string; channel: string; now: number; previous?: UpdateCheck | null;
    fetch?: typeof globalThis.fetch; timeoutMs?: number;
}): Promise<UpdateCheck> {
    const base = { checkedAt: options.now, installed: options.installed, channel: options.channel };
    // An earlier answer still counts while it names a version newer than the one installed now.
    const kept = options.previous?.available && (compareVersions(options.previous.available.latest, options.installed) ?? 0) > 0 ? options.previous.available : null;
    try {
        const response = await (options.fetch ?? globalThis.fetch)(updateCheckUrl(options, options.installed), {
            headers: { accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { ...base, available: kept, error: `The update server answered ${response.status}.` }; }
        return { ...base, available: parseUpdateAnswer(await response.json(), options.installed) };
    } catch (error) {
        return { ...base, available: kept, error: error instanceof Error ? error.message : 'The update server did not answer.' };
    }
}
