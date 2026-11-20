/** Development mail (requests.md C6): on a local APP_URL the sites' mail is kept and listed at /api/cms/dev/mail. */
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { clearDevMail, devMail, devMailTransport } from '../app/src/cms/dev-mail';
import { DELETE, GET } from '../app/src/pages/api/cms/dev/mail';

const message = (to: string) => ({ to, from: 'site@example.com', subject: 'Set your password', text: `Open http://localhost:5173/auth/invite?code=${to}`, html: '<p>Open</p>' });

function app(appUrl: string) {
    const hono = new Hono<{ Bindings: { APP_URL: string } }>();
    hono.get('/api/cms/dev/mail', GET);
    hono.delete('/api/cms/dev/mail', DELETE);
    return { request: (url: string, init?: RequestInit) => hono.request(url, init, { APP_URL: appUrl }) };
}

describe('development mail', () => {
    afterEach(() => { clearDevMail(); });

    it('keeps what a site sends, and still hands it to the transport', async () => {
        const handed: string[] = [];
        const log = console.log;
        console.log = () => {};
        try {
            await devMailTransport('main', { send: async mail => { handed.push(mail.to); } }).send(message('ada@example.com'));
            await devMailTransport('blog', undefined).send(message('bob@example.com'));
        } finally { console.log = log; }
        expect(handed).toEqual(['ada@example.com']);
        expect(devMail().map(mail => [mail.site, mail.to])).toEqual([['main', 'ada@example.com'], ['blog', 'bob@example.com']]);
        expect(devMail('ADA@example.com')).toHaveLength(1);
    });

    it('lists it only while APP_URL and the request name this machine', async () => {
        const log = console.log;
        console.log = () => {};
        try { await devMailTransport('main', undefined).send(message('ada@example.com')); }
        finally { console.log = log; }
        const local = app('http://localhost:5173');
        const listed = await local.request('http://localhost:5173/api/cms/dev/mail?to=ada@example.com');
        expect(listed.status).toBe(200);
        expect((await listed.json() as { mail: { text: string }[] }).mail[0]!.text).toContain('invite?code=ada@example.com');
        expect((await local.request('http://example.com/api/cms/dev/mail')).status).toBe(404);
        expect((await app('https://example.com').request('http://localhost/api/cms/dev/mail')).status).toBe(404);
        expect((await local.request('http://localhost:5173/api/cms/dev/mail', { method: 'DELETE' })).status).toBe(204);
        expect(devMail()).toEqual([]);
    });
});
