// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';

@Page({ transport: 'http' })
class Account extends Cossack {
    get currentUser() { return this.user; }
}
const metadata = { componentId: 'Account', pathname: '/account', url: '/account', params: {} };
const bootstrapped: Cossack[] = [];
async function bootstrap(options: Parameters<Cossack['bootstrap']>[0]) {
    const component = new Account();
    bootstrapped.push(component);
    await component.bootstrap({ skipInit: true, deferMount: true, ...options });
    return component;
}
afterEach(() => {
    for (const component of bootstrapped.splice(0)) component.destroy();
    delete (window as any).__INITIAL_STATE__;
});

describe('browser user from the hydration payload root', () => {
    it('reads the page user from the payload root', async () => {
        const page = await bootstrap({ initialState: { public: {}, metadata, user: { id: 'u1' } } });
        expect(page.currentUser).toEqual({ id: 'u1' });
    });

    it('ignores a user inside component metadata', async () => {
        const page = await bootstrap({ initialState: { public: {}, metadata: { ...metadata, user: { id: 'stale' } } } });
        expect(page.currentUser).toBeUndefined();
    });

    it('takes the root user from the framework for layout and App states that omit it', async () => {
        const layout = await bootstrap({ initialState: { public: {}, metadata }, user: { id: 'u1' } });
        expect(layout.currentUser).toEqual({ id: 'u1' });
    });

    it('reads the root user from window.__INITIAL_STATE__ when no state is passed', async () => {
        (window as any).__INITIAL_STATE__ = { public: {}, metadata, user: { id: 'w1' } };
        const page = await bootstrap({});
        expect(page.currentUser).toEqual({ id: 'w1' });
    });

    it('replaces a retained component user with the destination root user on navigation', async () => {
        const layout = await bootstrap({ initialState: { public: {}, metadata }, user: { id: 'u1' } });
        layout._frameworkHydrateNavigationResources({ public: {}, metadata }, '/account', '/account', { id: 'u2' });
        expect(layout.currentUser).toEqual({ id: 'u2' });
        layout._frameworkHydrateNavigationResources({ public: {}, metadata }, '/account', '/account', undefined);
        expect(layout.currentUser).toBeUndefined();
    });
});
