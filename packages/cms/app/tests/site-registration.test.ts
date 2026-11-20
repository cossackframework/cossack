import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RomeDB } from '@cossackframework/romedb';
import { CmsNetwork, contentModule, createCMS, NETWORK_ADMIN, systemPrincipal, type Principal } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';

const state = vi.hoisted(() => ({ network: undefined as CmsNetwork | undefined, c: undefined as unknown, sent: [] as { to: string; text: string }[] }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.network!.main, networkFor: () => state.network, siteUrl: () => undefined }));
vi.mock('@cossackframework/core', async original => ({ ...await original<typeof import('@cossackframework/core')>(), getRequestContext: () => state.c }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);
const { registerSite, siteRegistrationOpen, verifyEmail } = await import('../src/auth');

const networkAdmin: Principal = { kind: 'user', id: 'root', roles: ['admin', NETWORK_ADMIN], permissions: ['*'] };

/** A request from `address` to the network host, as getRequestContext gives it. */
function request(address = '203.0.113.1') {
    const url = 'https://example.com/auth/register-site';
    const raw = new Request(url, { headers: { 'cf-connecting-ip': address } });
    state.c = { env: { APP_URL: 'https://example.com' }, req: { url, raw, header: (name: string) => raw.headers.get(name) ?? undefined }, get: () => undefined, set: () => undefined };
}

describe.skipIf(!live)('registering a site from the sign-up page', () => {
    const service = romedbService();
    const added = new Map<string, { db: RomeDB; stop(): Promise<void> }>();

    beforeAll(async () => {
        const db = service.database();
        const mail = { send: async (message: { to: unknown; text: unknown }) => { state.sent.push({ to: String(message.to), text: String(message.text) }); } };
        state.network = new CmsNetwork({
            db, open: site => added.get(site.database)!.db, networkHost: () => 'example.com',
            directory: {
                async create(name) {
                    if (!added.has(`db-${name}`)) added.set(`db-${name}`, await service.fresh());
                    return `db-${name}`;
                },
                async delete() {},
            },
            host: (site, siteDb) => createCMS({ db: siteDb, network: db, site: site.id, modules: [contentModule], mail, mailFrom: 'network@example.com' }),
        });
        expect((await state.network.main.migrate()).failed).toBeUndefined();
        await state.network.setEnabled(true, { principal: systemPrincipal('tests') });
    }, 60_000);

    afterAll(async () => {
        for (const database of added.values()) await database.stop();
    });

    it('is closed until the network opens it', async () => {
        request();
        expect(await siteRegistrationOpen()).toBe(false);
        await expect(registerSite({ site: { name: 'Pho', host: 'pho.example.com' }, email: 'ada@example.com', password: 'long password' }, null)).rejects.toThrow(/closed/);
        await state.network!.saveSettings({ siteRegistration: true }, { principal: networkAdmin });
        expect(await siteRegistrationOpen()).toBe(true);
    });

    it('makes the site once the new account confirms its email, with the person as its administrator', async () => {
        request();
        state.sent.length = 0;
        expect(await registerSite({ site: { name: 'Pho', host: 'pho.example.com' }, name: 'Ada', email: 'ada@example.com', password: 'long password' }, null)).toEqual({ verification: 'sent' });
        const account = (await state.network!.main.accounts.findByEmail('ada@example.com'))!;
        expect(account).toMatchObject({ status: 'disabled', unconfirmed: true });
        expect(await state.network!.sites.get('pho')).toBeNull();
        expect(state.sent).toHaveLength(1);
        expect(state.sent[0]!.text).toContain('create your site Pho (pho.example.com)');
        const token = /verify\?token=([A-Za-z0-9_-]+)/.exec(state.sent[0]!.text)![1]!;
        expect(await verifyEmail(token)).toEqual({ user: account.id, pending: false, site: 'pho' });
        expect((await state.network!.main.accounts.get(account.id))?.status).toBe('active');
        const site = (await state.network!.hostById('pho'))!;
        expect((await site.users.get(account.id))?.roles).toEqual(['admin']);
        // The link is spent.
        expect(await verifyEmail(token)).toBeNull();
    }, 60_000);

    it('makes the site at once for an existing account with its password, and refuses a wrong one', async () => {
        request('203.0.113.2');
        await expect(registerSite({ site: { name: 'Bun', host: 'bun.example.com' }, email: 'ada@example.com', password: 'wrong password' }, null)).rejects.toThrow(/Enter its password/);
        expect(await state.network!.sites.get('bun')).toBeNull();
        const done = await registerSite({ site: { name: 'Bun', host: 'bun.example.com' }, email: 'ada@example.com', password: 'long password' }, null);
        expect(done).toMatchObject({ site: 'bun', signIn: true });
        // Signed in: the site alone.
        const ada = (await state.network!.main.accounts.findByEmail('ada@example.com'))!;
        expect(await registerSite({ site: { name: 'Com', host: 'com.example.com' } }, ada.id)).toMatchObject({ site: 'com', user: ada.id, signIn: false });
    }, 60_000);

    it('says what is wrong with the site before making an account', async () => {
        request('203.0.113.3');
        await expect(registerSite({ site: { name: 'Taken', host: 'pho.example.com' }, email: 'other@example.com', password: 'long password' }, null)).rejects.toThrow(/address is taken/);
        await expect(registerSite({ site: { name: 'Far', host: 'far.other.com' }, email: 'other@example.com', password: 'long password' }, null)).rejects.toThrow(/ending in .example.com/);
        expect(await state.network!.main.accounts.findByEmail('other@example.com')).toBeNull();
    });

    it('takes a few registrations an hour from one address', async () => {
        request('203.0.113.9');
        for (let index = 0; index < 10; index++) {
            await registerSite({ site: { name: 'X', host: 'pho.example.com' }, email: 'x@example.com', password: 'long password' }, null).catch(() => undefined);
        }
        await expect(registerSite({ site: { name: 'X', host: 'free.example.com' }, email: 'x@example.com', password: 'long password' }, null)).rejects.toThrow(/Too many sites/);
    });
});
