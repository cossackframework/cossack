import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';
const state = vi.hoisted(() => ({ cms: undefined as CmsHost | undefined }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.cms, networkFor: () => ({}), siteUrl: () => undefined }));
const { loginUser, beginTwoFactor, SignInPasskeyError } = await import('../src/auth');
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
});
