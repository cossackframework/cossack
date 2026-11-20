import type { Context } from 'hono';
import type { MailTransport } from '@cossackframework/cms/server';

/** An email the CMS sent while APP_URL names this machine. */
export interface DevMail {
    readonly site: string;
    readonly to: string;
    readonly from: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
    readonly replyTo?: string;
    /** When it was sent, in milliseconds since the epoch. */
    readonly sentAt: number;
}

/** The mail this isolate sent in development, oldest first; the newest 200. */
const sent: DevMail[] = [];
const KEPT = 200;

/**
 * Development: every email a site sends is kept in memory and printed in the dev server's
 * terminal, so a script reads an invitation's or a reset's link from `GET /api/cms/dev/mail`
 * instead of a mail service. With a transport (the local `EMAIL` binding, or `mail` in
 * src/cms.config.ts), the email goes there too; without one, it goes nowhere else.
 */
export function devMailTransport(site: string, transport: MailTransport | undefined): MailTransport {
    return {
        async send(message) {
            sent.push({ site, to: message.to, from: message.from, subject: message.subject, text: message.text, html: message.html,
                ...(message.replyTo ? { replyTo: message.replyTo } : {}), sentAt: Date.now() });
            if (sent.length > KEPT) sent.splice(0, sent.length - KEPT);
            console.log(`[cms] mail to ${message.to}: ${message.subject}\n${message.text}\n`);
            return transport?.send(message);
        },
    };
}

/** The mail kept so far, oldest first; `to` keeps one recipient's. */
export function devMail(to?: string): DevMail[] {
    const wanted = to?.trim().toLowerCase();
    return sent.filter(mail => !wanted || mail.to.toLowerCase() === wanted);
}

/** Forget the mail kept so far. */
export function clearDevMail(): void {
    sent.length = 0;
}

/**
 * Whether the request may read the development mail: APP_URL names this machine, and so does
 * the address the request reached. A deployment whose APP_URL was left local still answers 404
 * to a request from outside.
 */
export function devMailOpen(c: Context, appUrl: string | undefined): boolean {
    return local(appUrl) && local(c.req.url);
}

function local(address: string | undefined): boolean {
    let host: string;
    try { host = address ? new URL(address).hostname : ''; } catch { return false; }
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}
