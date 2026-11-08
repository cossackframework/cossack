import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHookRegistry, type HookRegistry } from '@cossackframework/core/hooks';
import { EXTENSION_POINTS, MAIL_ACCENT, MAIL_LIMITS, mailBeforeSend, mailBodyHtml, mailHtml, mailMessageOf, mailRecipientsLocked, type MailMessage } from '../src/index';
import { siteMailer, type OutgoingMail } from '../src/server/mail';

const site = { title: 'Acme', url: 'https://acme.example' };

describe('the mail layout', () => {
    it('escapes the text, keeps paragraphs and line breaks', () => {
        const body = mailBodyHtml('Hello <b>Ada</b> & "friends"\nsecond line\n\n\nNew paragraph\r\nwith CRLF');
        expect(body).toContain('Hello &lt;b&gt;Ada&lt;/b&gt; &amp; &quot;friends&quot;<br>\nsecond line</p>');
        expect(body).toContain('>New paragraph<br>\nwith CRLF</p>');
        expect(body.match(/<p /g)).toHaveLength(2);
        expect(body).not.toContain('<b>');
    });

    it('links bare http(s) addresses, without the punctuation after them', () => {
        const body = mailBodyHtml('See https://acme.example/a?x=1&y=2. Or (https://en.wikipedia.org/wiki/Foo_(bar)), javascript:alert(1) and ftp://files.example.');
        expect(body).toContain('href="https://acme.example/a?x=1&amp;y=2"');
        expect(body).toContain('>https://acme.example/a?x=1&amp;y=2</a>. Or (');
        expect(body).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
        expect(body).toContain('</a>), javascript:alert(1)');
        expect(body.match(/<a /g)).toHaveLength(2);
        // A quote cannot end the attribute: addresses stop at quotes and angle brackets.
        expect(mailBodyHtml('https://acme.example/"onmouseover="x')).toContain('href="https://acme.example/"');
    });

    it('makes a lone address on its own line a button, with the address under it', () => {
        const body = mailBodyHtml('Open this link to sign in:\nhttps://acme.example/auth/magic?token=abc\n\nIf you did not ask, ignore this.', { action: 'Sign in', accent: '#7c3aed' });
        expect(body).toMatch(/<p [^>]*>Open this link to sign in:<\/p>\n<table role="presentation"/);
        expect(body).toContain('bgcolor="#7c3aed"');
        expect(body).toMatch(/<a href="https:\/\/acme\.example\/auth\/magic\?token=abc"[^>]*color:#ffffff[^>]*>Sign in<\/a>/);
        expect(body).toContain('If the button does not work, open this address:');
        expect(body.match(/<table /g)).toHaveLength(1);
        // Two lone addresses: neither is the action, both are links.
        const two = mailBodyHtml('https://acme.example/a\nhttps://acme.example/b');
        expect(two).not.toContain('<table');
        expect(two.match(/<a /g)).toHaveLength(2);
        // An address inside a sentence is a link, not a button.
        expect(mailBodyHtml('Moderate: https://acme.example/dashboard')).not.toContain('<table');
    });

    it('quotes lines that start with >', () => {
        const body = mailBodyHtml('> said <this>\n> and that\n\nReply');
        expect(body).toContain('<blockquote');
        expect(body).toContain('said &lt;this&gt;<br>\nand that</blockquote>');
    });

    it('lays out the site title, logo and footer with inline styles and no remote fonts', () => {
        const html = mailHtml({ subject: 'Reset <now>', text: 'Hi', site: { ...site, title: 'Acme & Co', logo: 'https://acme.example/logo.png' }, footer: 'Acme Inc.\n1 Main St. <HQ>', lang: 'fr' });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('<html lang="fr">');
        expect(html).toContain('<title>Reset &lt;now&gt;</title>');
        expect(html).toContain('<img src="https://acme.example/logo.png"');
        expect(html.match(/<img /g)).toHaveLength(1);
        expect(html).toContain('Acme &amp; Co');
        expect(html).toContain('Acme Inc.<br>\n1 Main St. &lt;HQ&gt;');
        expect(html).toContain('>acme.example</a>');
        expect(html).not.toMatch(/<link|<style|@import|fonts\.googleapis|<script/);
        // No logo, no image; a logo that is not http(s) is dropped.
        expect(mailHtml({ subject: 's', text: 't', site }).includes('<img')).toBe(false);
        expect(mailHtml({ subject: 's', text: 't', site: { ...site, logo: 'javascript:alert(1)' } }).includes('<img')).toBe(false);
        // Without a title, the host stands in.
        expect(mailHtml({ subject: 's', text: 't', site: { title: '', url: 'https://acme.example/' } })).toContain('>acme.example</span>');
    });

    it('uses the accent color, and a readable ink on light ones', () => {
        expect(mailHtml({ subject: 's', text: 'https://acme.example/go', site, accent: 'nope' })).toContain(`bgcolor="${MAIL_ACCENT}"`);
        expect(mailHtml({ subject: 's', text: 'https://acme.example/go', site, accent: '#F0A' })).toContain('bgcolor="#ff00aa"');
        const light = mailHtml({ subject: 's', text: 'https://acme.example/go\n\nMore at https://acme.example/more', site, accent: '#ffff00' });
        expect(light).toMatch(/color:#18181b;text-decoration:none;border-radius:6px;">Open link<\/a>/);
        // Yellow links on white would be unreadable: they take the heading color.
        expect(light).toMatch(/href="https:\/\/acme\.example\/more"[^>]*style="color:#18181b;/);
    });
});

describe('cms.mail.before-send results', () => {
    const original: MailMessage = { to: 'ada@example.com', from: 'site@example.com', subject: 'Reset your password', text: 'Link', html: '<p>Link</p>', replyTo: 'help@example.com' };

    it('is an extension point of version 1', () => {
        expect(EXTENSION_POINTS).toContain(mailBeforeSend);
        expect(mailBeforeSend).toMatchObject({ kind: 'filter', name: 'cms.mail.before-send', version: 1 });
    });

    it('keeps the recipient, reply address and sender of locked kinds', () => {
        for (const kind of ['verification', 'reset', 'magic-link', 'invitation', 'other'] as const) {
            expect(mailRecipientsLocked(kind)).toBe(true);
            expect(mailMessageOf({ ...original, to: 'eve@evil.example', from: 'ceo@example.com', replyTo: 'eve@evil.example', subject: 'Changed' }, original, kind))
                .toEqual({ ...original, subject: 'Changed' });
        }
        for (const kind of ['comment', 'note', 'automation', 'form', 'plugin'] as const) expect(mailRecipientsLocked(kind)).toBe(false);
    });

    it('lets open kinds change the recipient to one valid address', () => {
        expect(mailMessageOf({ ...original, to: ' desk@example.com ', replyTo: undefined }, original, 'form')).toStrictEqual({ to: 'desk@example.com', from: original.from, subject: original.subject, text: original.text, html: original.html });
        expect(mailMessageOf({ ...original, replyTo: 'not an address' }, original, 'automation')).toStrictEqual(original);
        expect(mailMessageOf({ ...original, to: 'a@example.com, b@example.com', from: 'x@example.com' }, original, 'form')).toEqual(original);
        expect(mailMessageOf({ ...original, to: 'a@example.com\r\nBcc: b@example.com' }, original, 'comment')).toEqual(original);
    });

    it('cancels on null, keeps the original for junk, and caps sizes', () => {
        expect(mailMessageOf(null, original, 'reset')).toBeNull();
        expect(mailMessageOf('nope', original, 'reset')).toEqual(original);
        expect(mailMessageOf({ subject: 'Two\r\nlines', text: '', html: 'x'.repeat(MAIL_LIMITS.html + 1) }, original, 'reset')).toEqual({ ...original, subject: 'Two lines' });
        expect(mailMessageOf({ ...original, subject: 's'.repeat(400), text: 't'.repeat(MAIL_LIMITS.text + 1) }, original, 'note')!.subject).toHaveLength(MAIL_LIMITS.subject);
        expect(mailMessageOf({ ...original, text: 't'.repeat(MAIL_LIMITS.text + 1) }, original, 'note')!.text).toBe(original.text);
    });
});

describe('the site mailer', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    const settings = {
        'general.siteTitle': 'Acme', 'general.logo': '/media/logo.svg', 'general.appIcon': '/media/icon.png', 'general.favicon': '',
        'email.accentColor': '#7c3aed', 'email.logo': '', 'email.footer': 'Acme Inc., 1 Main St.', 'languages.default': 'en',
    };
    function setup(register?: (hooks: HookRegistry) => void, options: { settings?: () => Promise<Record<string, unknown>> } = {}) {
        const hooks = createHookRegistry();
        register?.(hooks);
        const sent: MailMessage[] = [];
        const mailer = siteMailer({ transport: { send: async message => { sent.push(message); } }, from: 'site@example.com', site: 'main', hooks,
            settings: options.settings ?? (async () => settings), siteUrl: () => 'https://acme.example' });
        return { sent, mailer };
    }
    const reset: OutgoingMail = { kind: 'reset', to: 'ada@example.com', subject: 'Reset your password', text: 'Choose a new password; the link works for one hour:\nhttps://acme.example/auth/reset-password?token=t0k3n\n\nIf you did not ask, ignore this email.' };

    it('sends the text with the HTML layout from the settings', async () => {
        const { sent, mailer } = setup();
        expect(await mailer.send(reset)).toBe(true);
        expect(sent).toHaveLength(1);
        const message = sent[0]!;
        expect(message).toMatchObject({ to: 'ada@example.com', from: 'site@example.com', subject: 'Reset your password', text: reset.text });
        expect(Object.keys(message).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
        // The SVG site logo is skipped for the app icon, made absolute.
        expect(message.html).toContain('<img src="https://acme.example/media/icon.png"');
        expect(message.html).toContain('bgcolor="#7c3aed"');
        expect(message.html).toContain('>Reset your password</a>');
        expect(message.html).toContain('Acme Inc., 1 Main St.');
        expect(message.html).toContain('href="https://acme.example/"');
    });

    it('lays out with defaults when the settings cannot be read', async () => {
        const { sent, mailer } = setup(undefined, { settings: async () => { throw new Error('database down'); } });
        await mailer.send({ to: 'ada@example.com', subject: 'Hi', text: 'Hello, see https://acme.example/news' });
        expect(sent[0]!.html).toContain(`href="https://acme.example/news" target="_blank" style="color:${MAIL_ACCENT};`);
        expect(sent[0]!.html).toContain('>acme.example</span>');
        expect(sent[0]!.html).not.toContain('<img');
    });

    it('passes what the message is to filters, which may change the subject and HTML', async () => {
        const inputs: unknown[] = [];
        const { sent, mailer } = setup(hooks => hooks.addFilter(mailBeforeSend, (message, { input }) => {
            inputs.push(input);
            return message && { ...message, subject: `[Acme] ${message.subject}`, html: message.html.replace('</body>', '<p>tracked</p></body>') };
        }, { plugin: 'brand' }));
        await mailer.send(reset);
        await mailer.send({ kind: 'plugin', plugin: 'desk', to: 'bob@example.com', subject: 'Ticket closed', text: 'Done.' });
        await mailer.send({ kind: 'nonsense' as never, to: 'bob@example.com', subject: 'Hi', text: 'Hello' });
        expect(inputs).toEqual([{ kind: 'reset', plugin: null, site: 'main' }, { kind: 'plugin', plugin: 'desk', site: 'main' }, { kind: 'other', plugin: null, site: 'main' }]);
        expect(sent.map(message => message.subject)).toEqual(['[Acme] Reset your password', '[Acme] Ticket closed', '[Acme] Hi']);
        expect(sent[0]!.html).toContain('<p>tracked</p></body>');
    });

    it('does not send what a filter cancels', async () => {
        const { sent, mailer } = setup(hooks => hooks.addFilter(mailBeforeSend, (message, { input }) => input.kind === 'comment' ? null : message, { plugin: 'quiet' }));
        expect(await mailer.send({ kind: 'comment', to: 'admin@example.com', subject: 'New comment', text: 'Hi' })).toBe(false);
        expect(await mailer.send(reset)).toBe(true);
        expect(sent.map(message => message.subject)).toEqual(['Reset your password']);
    });

    it('cannot send a password reset elsewhere, but can redirect a form notification', async () => {
        const { sent, mailer } = setup(hooks => hooks.addFilter(mailBeforeSend, message => message && { ...message, to: 'eve@evil.example', replyTo: 'eve@evil.example', from: 'eve@evil.example' }, { plugin: 'thief' }));
        await mailer.send(reset);
        await mailer.send({ kind: 'magic-link', to: 'ada@example.com', subject: 'Sign in', text: 'x' });
        await mailer.send({ kind: 'invitation', to: 'ada@example.com', subject: 'Join', text: 'x' });
        await mailer.send({ to: 'ada@example.com', subject: 'No kind', text: 'x' });
        await mailer.send({ kind: 'form', to: 'admin@example.com', subject: 'New message', text: 'x' });
        expect(sent.map(message => [message.to, message.from, message.replyTo])).toEqual([
            ['ada@example.com', 'site@example.com', undefined], ['ada@example.com', 'site@example.com', undefined], ['ada@example.com', 'site@example.com', undefined], ['ada@example.com', 'site@example.com', undefined],
            ['eve@evil.example', 'site@example.com', 'eve@evil.example'],
        ]);
    });

    it('sends the mail as laid out when a filter throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { sent, mailer } = setup(hooks => {
            hooks.addFilter(mailBeforeSend, () => null, { plugin: 'a-cancel', priority: 1 });
            hooks.addFilter(mailBeforeSend, () => { throw new Error('broken'); }, { plugin: 'b-broken', priority: 2 });
        });
        expect(await mailer.send(reset)).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.subject).toBe('Reset your password');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('sends the mail as laid out when a filter runs past its deadline', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { sent, mailer } = setup(hooks => hooks.addFilter(mailBeforeSend, () => new Promise<MailMessage | null>(() => undefined), { plugin: 'slow' }));
        const sending = mailer.send(reset);
        await vi.advanceTimersByTimeAsync(mailBeforeSend.timeoutMs + 10);
        expect(await sending).toBe(true);
        expect(sent.map(message => message.subject)).toEqual(['Reset your password']);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('throws what the transport throws, so the outbox retries', async () => {
        const mailer = siteMailer({ transport: { send: async () => { throw new Error('The mail service is down.'); } }, from: 'site@example.com', site: 'main', hooks: createHookRegistry(),
            settings: async () => settings, siteUrl: () => undefined });
        await expect(mailer.send(reset)).rejects.toThrow('The mail service is down.');
    });
});
