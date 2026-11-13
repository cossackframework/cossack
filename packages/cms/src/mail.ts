/**
 * The HTML part of the emails the CMS sends, laid out from their plain text: the site's name
 * (and logo) above, the message in a card, the footer below. Inline CSS and tables only, so it
 * renders alike in Gmail, Outlook and Apple Mail; system fonts, and no image but the site's own.
 * Client-safe; the host's mailer (`host.mail`) calls it for every message.
 */

/** The button and link color when Settings → Email has none. */
export const MAIL_ACCENT = '#2563eb';

export interface MailLayout {
    /** The message's subject: the document's title. */
    readonly subject: string;
    /** The plain-text part; the body is made from it. */
    readonly text: string;
    readonly site: {
        readonly title: string;
        /** The site's address, such as `https://example.com`: the header and the footer link to it. */
        readonly url?: string;
        /** An absolute http(s) image URL, shown before the title. */
        readonly logo?: string;
    };
    /** Plain text under the message, such as a postal address. */
    readonly footer?: string;
    /** Hex color of the button and links. Default {@link MAIL_ACCENT}. */
    readonly accent?: string;
    /** The button's text, when one line of the message is an address alone. Default `Open link`. */
    readonly action?: string;
    /** The document's language. Default `en`. */
    readonly lang?: string;
}

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const COLORS = { page: '#f4f4f5', card: '#ffffff', border: '#e4e4e7', text: '#27272a', heading: '#18181b', muted: '#71717a', quote: '#d4d4d8' } as const;
/** A URL in running text; trailing punctuation is trimmed after. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"`]+/g;
const LONE_URL = /^https?:\/\/[^\s<>"`]+$/;

/** The whole HTML document of a message. */
export function mailHtml(layout: MailLayout): string {
    const accent = hexColor(layout.accent) ?? MAIL_ACCENT;
    const link = contrast(accent, COLORS.card) >= 3 ? accent : COLORS.heading;
    const url = httpUrl(layout.site.url);
    const logo = httpUrl(layout.site.logo);
    const title = layout.site.title.trim() || (url ? new URL(url).host : '');
    const lang = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(layout.lang ?? '') ? layout.lang! : 'en';
    const name = escapeHtml(title);
    const heading = `${logo ? `<img src="${escapeHtml(logo)}" alt="" height="32" style="display:inline-block;height:32px;width:auto;max-width:200px;border:0;outline:none;vertical-align:middle;margin-right:10px;">` : ''}<span style="vertical-align:middle;">${name}</span>`;
    const footer = [
        ...(layout.footer?.trim() ? [`<p style="margin:0 0 8px 0;">${lines(layout.footer.trim(), COLORS.muted)}</p>`] : []),
        `<p style="margin:0;">${name}${url ? `${name ? ' &middot; ' : ''}${anchor(url, COLORS.muted, url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}` : ''}</p>`,
    ].join('');
    return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:18px;line-height:28px;font-weight:600;color:${COLORS.heading};">${url ? `<a href="${escapeHtml(url)}" target="_blank" style="color:${COLORS.heading};text-decoration:none;">${heading}</a>` : heading}</td></tr>
<tr><td style="background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:8px;padding:32px 28px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLORS.text};">${mailBodyHtml(layout.text, { accent, link, action: layout.action ?? 'Open link' })}</td></tr>
<tr><td style="padding:16px 4px 0 4px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">${footer}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/**
 * A message's plain text as HTML: everything escaped, paragraphs at blank lines, line breaks
 * kept, bare http(s) addresses linked, and `>` lines as a quote. When exactly one line of the
 * text is an address alone, it becomes a button, with the address under it for clients that
 * hide buttons.
 */
export function mailBodyHtml(text: string, options: { readonly accent?: string; readonly link?: string; readonly action?: string } = {}): string {
    const accent = hexColor(options.accent) ?? MAIL_ACCENT;
    const link = hexColor(options.link) ?? (contrast(accent, COLORS.card) >= 3 ? accent : COLORS.heading);
    const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map(part => part.replace(/^\n+|\n+$/g, '')).filter(part => part.trim());
    const quoted = (rows: readonly string[]) => rows.every(row => /^\s*>/.test(row));
    const alone = paragraphs.map(part => part.split('\n')).filter(rows => !quoted(rows)).flat().filter(line => LONE_URL.test(line.trim()));
    const action = alone.length === 1 ? alone[0]!.trim() : null;
    const out: string[] = [];
    for (const paragraph of paragraphs) {
        const rows = paragraph.split('\n');
        if (quoted(rows)) {
            out.push(`<blockquote style="margin:0 0 16px 0;padding:0 0 0 12px;border-left:3px solid ${COLORS.quote};color:${COLORS.muted};">${lines(rows.map(row => row.replace(/^\s*>\s?/, '')).join('\n'), link)}</blockquote>`);
            continue;
        }
        let buffer: string[] = [];
        const flush = () => { if (buffer.some(row => row.trim())) out.push(`<p style="margin:0 0 16px 0;">${lines(buffer.join('\n'), link)}</p>`); buffer = []; };
        for (const row of rows) {
            if (action !== null && row.trim() === action) { flush(); out.push(button(action, options.action?.trim() || 'Open link', accent, link)); }
            else buffer.push(row);
        }
        flush();
    }
    return out.join('\n');
}

function button(url: string, label: string, accent: string, link: string): string {
    const ink = contrast('#ffffff', accent) >= contrast(COLORS.heading, accent) ? '#ffffff' : COLORS.heading;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;border-collapse:separate;"><tr><td align="center" bgcolor="${accent}" style="border-radius:6px;background-color:${accent};">`
        + `<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${ink};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`
        + `<p style="margin:0 0 16px 0;font-size:13px;line-height:20px;color:${COLORS.muted};">If the button does not work, open this address: ${anchor(url, link)}</p>`;
}

/** Escaped lines joined by `<br>`, with their addresses linked. */
function lines(text: string, color: string): string {
    return text.split('\n').map(line => linked(line, color)).join('<br>\n');
}

function linked(line: string, color: string): string {
    let out = '';
    let last = 0;
    for (const match of line.matchAll(URL_IN_TEXT)) {
        const url = trimUrl(match[0]);
        const start = match.index!;
        out += escapeHtml(line.slice(last, start)) + anchor(url, color);
        last = start + url.length;
    }
    return out + escapeHtml(line.slice(last));
}

function anchor(url: string, color: string, label = url): string {
    return `<a href="${escapeHtml(url)}" target="_blank" style="color:${color};text-decoration:underline;word-break:break-all;">${escapeHtml(label)}</a>`;
}

/** Drop the punctuation a sentence puts after an address, and closing brackets it does not open. */
function trimUrl(url: string): string {
    let end = url.length;
    while (end > 0) {
        const char = url[end - 1]!;
        const pair = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[char];
        const head = url.slice(0, end);
        if (/[.,;:!?'*”’»]/.test(char) || (pair && head.split(pair).length <= head.split(char).length - 1)) end--;
        else break;
    }
    return url.slice(0, end);
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function httpUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as opaque `#rrggbb`; null for anything else. */
function hexColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
    if (!match) return null;
    const digits = match[1]!.length <= 4 ? [...match[1]!.slice(0, 3)].map(digit => digit + digit).join('') : match[1]!.slice(0, 6);
    return `#${digits.toLowerCase()}`;
}

function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(at => {
        const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
