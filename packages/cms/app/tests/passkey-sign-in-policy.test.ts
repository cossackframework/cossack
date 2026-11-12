import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';
const state = vi.hoisted(() => ({ cms: undefined as CmsHost | undefined }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.cms, networkFor: () => ({ memberSites: async () => [{ id: 'main' }] }), siteUrl: () => undefined }));
const { loginUser, beginTwoFactor, SignInPasskeyError, secondFactorRequired, accountNeedsSecondFactor } = await import('../src/auth');
describe.skipIf(!live)('mandatory two-step sign-in with a passkey', () => {
    const service = romedbService();
    beforeAll(async () => {
        state.cms = createCMS({ db: service.database(), modules: [contentModule] });
        expect((await state.cms.migrate()).failed).toBeUndefined(); await state.cms.ready({ force: true });
    });
    it('refuses a password alone for an account whose second step is a passkey', async () => {
        const cms = state.cms!;
        await cms.users.defineRole({ id: 'admin', name: 'Administrator', permissions: ['*'] });
        const account = await cms.users.create({ email: 'passkey@example.test', password: 'Password-only-review-12', name: 'Admin', roles: ['admin'] });
        await cms.security.addPasskey(account.id, { id: 'registered-key', publicKey: 'pk', counter: 0 }, 'Existing key');
        await cms.settings.update('general', { requireTwoFactor: true }, { principal: systemPrincipal('test') });
        const user = await loginUser(account.email, 'Password-only-review-12', 'review-ip');
        expect(user).not.toBeNull();
        await expect(beginTwoFactor(user!.id)).rejects.toBeInstanceOf(SignInPasskeyError);
        // Not required, a password still signs in.
        await cms.settings.update('general', { requireTwoFactor: false }, { principal: systemPrincipal('test') });
        expect(await beginTwoFactor(user!.id)).toBeNull();
    });

    it('asks the session, not the account, whether it used a second factor', async () => {
        const cms = state.cms!;
        const account = await cms.users.create({ email: 'session-factor@example.test', password: 'Password-only-review-12', name: 'Editor', roles: ['admin'] });
        const user = (await loginUser(account.email, 'Password-only-review-12', 'review-ip'))!;
        const session = (secondFactor: boolean) => ({ get: (key: string) => key === 'cms.sessionSecondFactor' ? secondFactor : undefined }) as never;
        await cms.settings.update('general', { requireTwoFactor: true }, { principal: systemPrincipal('test') });
        expect(await accountNeedsSecondFactor(user)).toBe(true);
        expect(await secondFactorRequired(user, session(false))).toBe(true);
        // Once the account has a factor, a session signed in with a password alone is still held back.
        await cms.security.addPasskey(account.id, { id: 'session-key', publicKey: 'pk', counter: 0 }, 'Key');
        expect(await accountNeedsSecondFactor(user)).toBe(false);
        expect(await secondFactorRequired(user, session(false))).toBe(true);
        expect(await secondFactorRequired(user, session(true))).toBe(false);
        await cms.settings.update('general', { requireTwoFactor: false }, { principal: systemPrincipal('test') });
        expect(await secondFactorRequired(user, session(false))).toBe(false);
    });
});
