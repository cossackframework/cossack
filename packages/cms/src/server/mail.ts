/**
 * The site's mailer, `host.mail`: every email the CMS sends goes out as its plain text plus an
 * HTML part laid out from it with Settings → Email, after the `cms.mail.before-send` filters,
 * through the application's transport (Cloudflare's `EMAIL` binding, the Node adapter's SMTP
 * sender, or any `{ send(message) }`).
 */
import type { HookRegistry } from '@cossackframework/core/hooks';
import { mailBeforeSend, mailMessageOf, MAIL_KINDS, type MailKind, type MailMessage, type MailSendInput } from '../hooks';
import { mailHtml } from '../mail';

/** What hands a laid-out message to a mail service. */
export interface MailTransport {
    send(message: MailMessage): Promise<unknown>;
}

/** A message for `host.mail.send`: plain text, which the mailer lays out as HTML too. */
export interface OutgoingMail {
    readonly to: string;
    /** Default: the site's sender (`mailFrom`). */
    readonly from?: string;
    readonly subject: string;
    readonly text: string;
    readonly replyTo?: string;
    /** What it is, for `cms.mail.before-send` filters and the button's text. Default `other`, whose recipient filters cannot change. */
    readonly kind?: MailKind;
    /** The plugin sending it, for `kind: 'plugin'`. */
    readonly plugin?: string;
}

export interface CmsMailer {
    /** Lay out, filter and send one message: false when a filter cancelled it. Transport errors are thrown. */
    send(message: OutgoingMail): Promise<boolean>;
}

export interface SiteMailerOptions {
    readonly transport: MailTransport;
    /** The sender when a message names none. */
    readonly from: string;
    readonly site: string;
    readonly hooks: Pick<HookRegistry, 'applyFilters'>;
    /** The site's settings, for the layout; when they cannot be read, the defaults are used. */
    readonly settings: () => Promise<Readonly<Record<string, unknown>>>;
    /** The site's public address, for links and a root-relative logo. */
    readonly siteUrl: () => string | undefined;
}

/** The button's text by the kind of message, when one line of it is a link alone. */
const ACTIONS: Partial<Record<MailKind, string>> = {
    verification: 'Confirm your email', reset: 'Reset your password', 'magic-link': 'Sign in', invitation: 'Set your password', comment: 'Open the page', note: 'Open the notes',
};

export function siteMailer(options: SiteMailerOptions): CmsMailer {
    return {
        async send(message) {
            const kind: MailKind = (MAIL_KINDS as readonly string[]).includes(message.kind ?? '') ? message.kind! : 'other';
            const subject = message.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
            const settings = await options.settings().catch(() => ({} as Readonly<Record<string, unknown>>));
            const text = (key: string) => typeof settings[key] === 'string' ? settings[key] as string : '';
            const siteUrl = options.siteUrl()?.trim() || undefined;
            const logo = mailLogo([text('email.logo'), text('general.logo'), text('general.appIcon'), text('general.favicon')], siteUrl);
            const html = mailHtml({
                subject, text: message.text,
                site: { title: text('general.siteTitle'), ...(siteUrl ? { url: siteUrl } : {}), ...(logo ? { logo } : {}) },
                footer: text('email.footer'), accent: text('email.accentColor'), lang: text('languages.default'), ...(ACTIONS[kind] ? { action: ACTIONS[kind] } : {}),
            });
            const laid: MailMessage = { to: message.to, from: message.from ?? options.from, subject, text: message.text, html, ...(message.replyTo ? { replyTo: message.replyTo } : {}) };
            const input: MailSendInput = { kind, plugin: kind === 'plugin' ? message.plugin ?? null : null, site: options.site };
            const final = await options.hooks.applyFilters(mailBeforeSend, laid as MailMessage | null, input).then(
                value => mailMessageOf(value, laid, kind),
                error => { console.warn(`[cms] a ${mailBeforeSend.name} filter failed, so the ${kind} email to ${laid.to} goes out as laid out`, error); return laid; });
            if (!final) return false;
            await options.transport.send(final);
            return true;
        },
    };
}

/**
 * The first logo that can show in an email, as an absolute URL: Settings → Email's as chosen,
 * then the site's logo, app icon and site icon unless they are SVG, which many email apps do
 * not show. A root-relative one needs the site's address.
 */
function mailLogo(candidates: readonly string[], siteUrl: string | undefined): string | undefined {
    for (const [index, candidate] of candidates.entries()) {
        const value = candidate.trim();
        if (!value || (index > 0 && /\.svg(?:[?#]|$)/i.test(value))) continue;
        try {
            const url = new URL(value, siteUrl);
            if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
        } catch { /* a relative address without the site's: none */ }
    }
    return undefined;
}
