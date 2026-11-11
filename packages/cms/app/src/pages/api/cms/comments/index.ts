import type { Context } from 'hono';
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';
import { isCmsError, isSameOriginPost, systemPrincipal, type CommentShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { getCookie } from 'hono/cookie';
import { getClientIp } from '@cossackframework/core';
import { apiError } from '../../../../cms/content-api';
import { mailOrigin } from '../../../../cms/seo';
import { isMembersOnly, isProtected, requestLock, unlockCookie } from '../../../../cms/site';

/**
 * Approved comments of an entry, oldest first, for headless sites:
 * `GET /api/cms/comments?collection=posts&entry=<id>`. Replies name their `parentId`.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    try {
        const collection = cms.collection(c.req.query('collection') ?? '');
        const entry = await cms.resource(`cms/${collection.name}`).get(c.req.query('entry') ?? '', { principal: { kind: 'anonymous' } });
        // A locked entry's discussion is as locked as its content.
        const lock = entry ? await lockedFor(c, cms, collection.name, entry) : null;
        if (!collection.comments || !entry || !lock || lock.locked) return c.json({ error: 'Entry not found.', code: 'CMS_NOT_FOUND' }, 404);
        const comments = await cms.comments.forEntry(`cms/${collection.name}`, entry.id);
        // Protected and members-only entries answer per reader: never from a shared cache.
        c.header('cache-control', lock.lockable ? 'private, no-store' : 'public, max-age=60');
        return c.json({ items: comments.map(comment => ({ id: comment.id, parentId: comment.parentId, author: comment.authorName, authorUrl: comment.authorUrl || null, content: comment.content, createdAt: comment.createdAt })) });
    } catch (error) { return apiError(c, error); }
};

/** What went wrong, for the form's message after a redirect. */
const REASONS: Record<string, string> = { CMS_FORBIDDEN: 'closed', CMS_UNAUTHENTICATED: 'sign-in', CMS_LIMIT: 'too-fast', CMS_VALIDATION: 'invalid', CMS_NOT_FOUND: 'closed' };

/**
 * Post a comment from the site's form (`collection`, `entry`, `parent`, `content`,
 * `authorName`, `authorEmail`, `authorUrl`) or as JSON. Forms return to the entry; JSON
 * answers with the comment's status. Turnstile checks the form when its keys are set.
 */
export const POST = async (c: Context) => {
    if (!isSameOriginPost(c.req.raw)) return c.json({ error: 'Cross-site comments are not allowed.', code: 'CMS_FORBIDDEN' }, 403);
    const cms = c.get('cms');
    const json = (c.req.header('content-type') ?? '').includes('application/json');
    let input: Record<string, string>;
    try {
        const raw = json ? await c.req.json() as Record<string, unknown> : Object.fromEntries(await c.req.formData());
        input = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value : '']));
    } catch { return c.json({ error: 'Send the comment as a form or JSON.', code: 'CMS_VALIDATION' }, 400); }
    const back = async (reason: string, url: string | null) => c.redirect(`${url ?? '/'}?comment=${reason}#comments`, 303);
    // The address the deployment trusts (TRUSTED_PROXY_HEADER, or the socket), not a header anyone can send.
    const address = getClientIp(c);
    const ip = address && address !== 'anonymous' ? address : undefined;
    const secret = env('TURNSTILE_SECRET_KEY', '');
    if (secret && env('TURNSTILE_SITE_KEY', '')) {
        const verifier = createTurnstileVerifier({ secret, expectedHostname: env('TURNSTILE_HOSTNAME', '') || new URL(c.req.url).hostname, expectedAction: 'comment' });
        const verdict = await verifier.verify({ token: input['cf-turnstile-response'] ?? input.turnstile, ...(ip && /^[a-fA-F0-9:.]{1,64}$/.test(ip) ? { remoteIP: ip } : {}) });
        if (!verdict.success) return json ? c.json({ error: 'The check against bots failed. Try again.', code: 'CMS_FORBIDDEN' }, 403) : back('bot', await entryUrl(cms, input));
    }
    try {
        const target = await commentTarget(cms, input);
        if (target && (await lockedFor(c, cms, target.collection, target.entry)).locked) return json ? c.json({ error: 'Entry not found.', code: 'CMS_NOT_FOUND' }, 404) : back('closed', await entryUrl(cms, input));
        const posted = await cms.postComment({
            collection: input.collection ?? '', entry: input.entry ?? '', parent: input.parent || null, content: input.content ?? '',
            authorName: input.authorName ?? '', authorEmail: input.authorEmail ?? '', authorUrl: input.authorUrl ?? '', trap: input.website ?? '',
        }, { principal: c.get('principal'), ...(ip ? { ip } : {}), userAgent: c.req.header('user-agent') ?? '' });
        notify(c, cms, posted.comment, posted.entry.title as string, posted.entry.owner, posted.url);
        if (json) return c.json({ comment: { id: posted.comment.id, status: posted.comment.status } }, 201);
        // Spam is treated like a held comment, so bots learn nothing.
        return c.redirect(`${posted.url ?? '/'}?comment=${posted.comment.status === 'approved' ? 'posted' : 'held'}#${posted.comment.status === 'approved' ? `comment-${posted.comment.id}` : 'comments'}`, 303);
    } catch (error) {
        if (json || !isCmsError(error)) return apiError(c, error);
        return back(REASONS[error.code] ?? 'invalid', await entryUrl(cms, input));
    }
};

/** The entry's lock for this request's reader (a password not typed, or members only), and whether it has one at all. */
async function lockedFor(c: Context, cms: CmsHost, collection: string, entry: { id: string }): Promise<{ locked: boolean; lockable: boolean }> {
    // The anonymous read leaves the password out; the lock needs the stored one.
    const record = await cms.resource(`cms/${collection}`).get(entry.id, { principal: systemPrincipal('comments') });
    if (!record) return { locked: true, lockable: true };
    const lockable = isProtected(record) || isMembersOnly(record);
    return { locked: lockable && await requestLock(cms, record, `cms/${collection}`, c.get('principal'), getCookie(c, unlockCookie(record))) !== null, lockable };
}

async function commentTarget(cms: CmsHost, input: Record<string, string>): Promise<{ collection: string; entry: Record<string, unknown> & { id: string } } | null> {
    try {
        const collection = cms.collection(input.collection ?? '');
        const entry = await cms.resource(`cms/${collection.name}`).get(input.entry ?? '', { principal: { kind: 'anonymous' } });
        return entry ? { collection: collection.name, entry } : null;
    } catch { return null; }
}

async function entryUrl(cms: CmsHost, input: Record<string, string>): Promise<string | null> {
    try {
        const collection = cms.collection(input.collection ?? '');
        const entry = await cms.resource(`cms/${collection.name}`).get(input.entry ?? '', { principal: { kind: 'anonymous' } });
        return entry ? (await cms.entryUrls(collection, [entry])).get(entry.id) ?? null : null;
    } catch { return null; }
}

/** Email the site and the entry's author about the comment, as Settings → Discussion asks. Needs a mail sender (`EMAIL`). */
function notify(c: Context, cms: CmsHost, comment: CommentShape, title: string, owner: string | null, url: string | null): void {
    const mail = cms.mail;
    if (!mail || comment.status === 'spam') return;
    const work = (async () => {
        const settings = await cms.settings.all();
        const recipients = new Set<string>();
        const held = comment.status === 'pending';
        if (settings['general.adminEmail'] && (held ? settings['discussion.notifyHeld'] : settings['discussion.notifyPosted'])) recipients.add(settings['general.adminEmail']);
        if (!held && settings['discussion.notifyAuthor'] && owner && owner !== comment.userId) {
            const author = await cms.users.get(owner);
            if (author) recipients.add(author.email);
        }
        // Links only from an address the site set, never from the poster's Host header.
        const origin = mailOrigin(c);
        const subject = `${held ? 'Please moderate' : 'New comment'}: “${title}”`;
        const links = origin ? `${url ? `${origin}${url}\n` : ''}Moderate: ${origin}/dashboard/comments?status=${comment.status}` : 'Moderate it under Comments in the dashboard.';
        const text = `${comment.authorName} <${comment.authorEmail}> wrote on “${title}”:\n\n${comment.content}\n\n${links}`;
        for (const to of recipients) await mail.send({ kind: 'comment', to, from: cms.mailFrom, subject, text });
    })().catch(error => console.error('[cms] could not send comment notifications', error));
    try { c.executionCtx.waitUntil(work); } catch { /* Node keeps running the promise. */ }
}
