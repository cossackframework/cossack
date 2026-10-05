import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, getRequestContext } from '@cossackframework/core';

const { registry, session } = vi.hoisted(() => ({
    registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
    session: { userId: 'u1' },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
    c.set('user', { id: session.userId });
    await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

const pagePath = '/src/pages/room/index.ts';
const routeGuard = vi.fn(async (c: any, next: () => Promise<void>) => { c.set('routeGuard', true); await next(); });
class Room extends Cossack {}
Reflect.defineMetadata('page:options', {
    scope: (c: any) => `team:${c.req.param('team')}`,
    middlewares: [routeGuard],
}, Room);
registry.pages[pagePath] = { default: Room };
const { AppDurableObject } = await import('../src/DurableObject');

afterEach(() => { session.userId = 'u1'; routeGuard.mockClear(); });

function objectUnderTest() {
    const object = Object.create(AppDurableObject.prototype) as any;
    object.env = { BINDING: 'test' };
    return object;
}

function peer() {
    const request = {
        url: 'https://example.test/ws/page/id?routePath=/room', params: { team: 'alpha' },
        headers: [['accept-language', 'fr']] as [string, string][], locale: 'fr',
    };
    return {
        user: { id: 'u1' }, identity: { version: 1, provider: 'fixture.session', data: { reference: 'opaque' } },
        request, componentPath: pagePath, scopeKey: 'team:alpha',
    };
}

it('restores a fresh DO peer scope and runs actions under current inherited authorization', async () => {
    const operation = vi.fn(async (fresh: any) => {
        expect(getRequestContext()).toBe(fresh);
        expect(fresh.get('user')).toEqual({ id: 'u1' });
        expect(fresh.get('cossack.realtimeIdentity')).toEqual(peer().identity);
        expect(fresh.get('routeGuard')).toBe(true);
        expect(fresh.req.param('team')).toBe('alpha');
        expect(fresh.req.header('cookie')).toBeUndefined();
        expect(fresh.req.header('authorization')).toBeUndefined();
        expect(fresh.env).toEqual({ BINDING: 'test' });
    });
    expect(await objectUnderTest().authorizeWebSocketPeer(undefined, peer(), operation)).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
    expect(routeGuard).toHaveBeenCalledOnce();
});

it('closes a hibernated peer after its user or scope changes', async () => {
    const object = objectUnderTest();
    const operation = vi.fn();
    session.userId = 'u2';
    expect(await object.authorizeWebSocketPeer(undefined, peer(), operation)).toBe(false);
    expect(operation).not.toHaveBeenCalled();
    session.userId = 'u1';
    const staleScope = { ...peer(), scopeKey: 'team:other' };
    expect(await object.authorizeWebSocketPeer(undefined, staleScope, operation)).toBe(false);
    expect(operation).not.toHaveBeenCalled();
});
