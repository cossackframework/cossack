import { compareVersions } from '@cossackframework/cms/updates';

/** One published version of a channel. */
export interface Release {
    version: string;
    /** When it was published, as an ISO date. */
    published?: string;
    /** The release notes. */
    notes?: string;
    /** It fixes a security problem. */
    security?: boolean;
    /** The scaffold template it needs, when it changes what served code asks of a project. */
    hostTemplate?: string;
    /** The oldest version that can go to it in one step. */
    minimumFrom?: string;
}

export interface ReleaseList { channels: Record<string, Release[]> }

/** What the server answers (specs/cms-updates.md, "The update server"). */
export interface Answer {
    channel: string;
    latest: string;
    published?: string;
    notes?: string;
    /** A release after the asked version, up to the latest, fixes a security problem. */
    security: boolean;
    hostTemplate?: string;
    minimumFrom?: string;
}

const newer = (a: string, b: string) => (compareVersions(a, b) ?? 0) > 0;

/** The latest release of a channel for a site that runs `version`, or null for a channel that has none. */
export function updateAnswer(list: ReleaseList, version: string, channel: string): Answer | null {
    const releases = (list.channels[channel] ?? []).filter(release => compareVersions(release.version, release.version) === 0);
    if (!releases.length) return null;
    const latest = releases.reduce((best, release) => newer(release.version, best.version) ? release : best);
    // Every fix between the site's version and the latest counts, not only the latest release's.
    const security = releases.some(release => release.security === true && newer(release.version, version) && !newer(release.version, latest.version));
    // The strictest starting point among the releases the site would skip.
    const skipped = releases.filter(release => newer(release.version, version) && release.minimumFrom);
    const minimumFrom = skipped.map(release => release.minimumFrom!).reduce<string | undefined>((most, candidate) => !most || newer(candidate, most) ? candidate : most, undefined);
    return {
        channel, latest: latest.version, security,
        ...(latest.published ? { published: latest.published } : {}),
        ...(latest.notes ? { notes: latest.notes } : {}),
        ...(latest.hostTemplate ? { hostTemplate: latest.hostTemplate } : {}),
        ...(minimumFrom && newer(minimumFrom, version) ? { minimumFrom } : {}),
    };
}
