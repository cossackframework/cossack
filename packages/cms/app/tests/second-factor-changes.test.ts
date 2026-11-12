import { beforeAll, describe, expect, it, vi } from 'vitest';
import { totpCode, totpStep } from '@cossackframework/auth';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';

/**
 * A session signed in with a password alone, while General settings require two-step sign-in,
 * may set up the account's first factor but never take a factor away: it could then set up its
 * own and count as two-step. Codes checked on the security page count against the account's
 * tries, as at sign-in.
 */
const state = vi.hoisted(() => ({ cms: undefined as CmsHost | undefined, user: undefined as unknown, secondFactor: false }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.cms, networkFor: () => ({ memberSites: async () => [{ id: 'main' }], main: { accounts: { memberships: async () => new Map() } }, sites: { getMany: async () => [] } }), siteUrl: () => undefined }));
vi.mock('@cossackframework/core', async original => ({
    ...await original<typeof import('@cossackframework/core')>(),
    getRequestContext: () => ({ env: {}, get: (key: string) => key === 'user' ? state.user : key === 'cms.sessionSecondFactor' ? state.secondFactor : undefined }),
}));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
const { disableAuthenticator, newRecoveryCodes, removePasskey, PASSKEY_CHALLENGES, passkeySignIn } = await import('../src/auth');

describe.skipIf(!live)('second factors changed from a session', () => {
    const service = romedbService();
    let accountId = '';
    let secret = '';

    beforeAll(async () => {
        const cms = state.cms = createCMS({ db: service.database(), modules: [contentModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        await cms.users.defineRole({ id: 'admin', name: 'Administrator', permissions: ['*'] });
        const account = await cms.users.create({ email: 'owner@example.test', password: 'Owner-password-long-1', name: 'Owner', roles: ['admin'] });
        accountId = account.id;
        state.user = { id: account.id, email: account.email, name: 'Owner', principal: { kind: 'user', id: account.id, roles: ['admin'], permissions: ['*'] } };
        secret = await cms.security.startTotp(account.id);
        await cms.security.confirmTotp(account.id, await totpCode(secret, totpStep(Date.now())));
        await cms.security.addPasskey(account.id, { id: 'owner-key', publicKey: 'pk', counter: 0 }, 'Owner key');
        await cms.settings.update('general', { requireTwoFactor: true }, { principal: systemPrincipal('test') });
    }, 30_000);

    it('refuses a password-only session removing or replacing factors, even with a right code', async () => {
        state.secondFactor = false;
        const code = await totpCode(secret, totpStep(Date.now()) + 1);
        await expect(removePasskey(accountId, 'owner-key')).rejects.toThrow(/sign in again/);
        await expect(disableAuthenticator(accountId, code)).rejects.toThrow(/sign in again/);
        await expect(newRecoveryCodes(accountId, code)).rejects.toThrow(/sign in again/);
        expect(await state.cms!.security.status(accountId)).toMatchObject({ totp: true, passkeys: [expect.objectContaining({ id: 'owner-key' })] });
    });

    it('counts wrong codes on the security page against the account, then locks it', async () => {
        state.secondFactor = true;
        for (let i = 0; i < 10; i++) await expect(disableAuthenticator(accountId, '000000')).rejects.toThrow(/not right/);
        // The eleventh is refused before the code is even checked: a right one too.
        await expect(disableAuthenticator(accountId, await totpCode(secret, totpStep(Date.now()) + 2))).rejects.toThrow(/Too many wrong codes/);
        await expect(newRecoveryCodes(accountId, '000000')).rejects.toThrow(/Too many wrong codes/);
        expect((await state.cms!.security.status(accountId)).totp).toBe(true);
    });

    it('lets a session that used its second factor remove a passkey', async () => {
        state.secondFactor = true;
        await removePasskey(accountId, 'owner-key');
        expect((await state.cms!.security.status(accountId)).passkeys).toEqual([]);
    });

    it('limits the passkey sign-in challenges one address starts', async () => {
        const c = { req: { url: 'http://cms.test/auth/login', header: () => undefined, raw: new Request('http://cms.test/auth/login') }, env: {}, get: () => undefined } as never;
        for (let i = 0; i < PASSKEY_CHALLENGES.perAddress; i++) expect((await passkeySignIn(c)).challenge).toBeTruthy();
        await expect(passkeySignIn(c)).rejects.toThrow(/Too many passkey sign-ins/);
    });
});
