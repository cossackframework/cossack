import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CossackService, getRequestContext, Service, ServiceScope, setRequestContextGetter } from '@cossackframework/core';
import { controlledAsync, withRequestScope } from '../src/server';

describe('withRequestScope (RT-29)', () => {
    it('scopes getRequestContext to the supplied context and restores the getter', async () => {
        expect(getRequestContext()).toBeUndefined();
        const context = { req: { path: '/test' } } as any;
        await withRequestScope({ context }, async () => {
            expect(getRequestContext()).toBe(context);
        });
        // The getter is reset after the scope ends.
        expect(getRequestContext()).toBeUndefined();
    });

    it('provides a disposed root service scope with request facilities', async () => {
        const context = { req: { path: '/' } } as any;
        const seen: string[] = [];
        await withRequestScope({ context, user: { id: 'u1' } as any, env: { APP_URL: 'https://test' } }, async ({ serviceScope }) => {
            const facilities = serviceScope.getRequestContext();
            seen.push(String((facilities.user as any)?.id), String((facilities.env as any)?.APP_URL));
        });
        expect(seen).toEqual(['u1', 'https://test']);
    });

    it('cleans up the scope when the callback throws', async () => {
        const context = { req: { path: '/' } } as any;
        await expect(withRequestScope({ context }, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        // The request-context getter is restored even on failure.
        expect(getRequestContext()).toBeUndefined();
    });

    it('preserves an existing framework getter through nested scopes', async () => {
        const framework = { req: { path: '/framework' } } as any;
        const outer = { req: { path: '/outer' } } as any;
        const inner = { req: { path: '/inner' } } as any;
        setRequestContextGetter(() => framework);
        try {
            await withRequestScope({ context: outer }, async () => {
                await withRequestScope({ context: inner }, async () => {
                    expect(getRequestContext()).toBe(inner);
                });
                expect(getRequestContext()).toBe(outer);
            });
            expect(getRequestContext()).toBe(framework);
        } finally { setRequestContextGetter(null); }
    });

    it('isolates overlapping scopes even when one completes first', async () => {
        const firstReady = controlledAsync<void>();
        const releaseFirst = controlledAsync<void>();
        const first = { req: { path: '/first' } } as any;
        const second = { req: { path: '/second' } } as any;
        const a = withRequestScope({ context: first }, async () => {
            firstReady.resolve();
            await releaseFirst.promise;
            expect(getRequestContext()).toBe(first);
        });
        await firstReady.promise;
        await withRequestScope({ context: second }, async () => {
            expect(getRequestContext()).toBe(second);
        });
        releaseFirst.resolve();
        await a;
        expect(getRequestContext()).toBeUndefined();
    });

    it('retains request context until asynchronous service disposal finishes', async () => {
        const context = { req: { path: '/cleanup' } } as any;
        const observed: unknown[] = [];
        class Owned extends CossackService {
            async onDispose() {
                await Promise.resolve();
                observed.push(getRequestContext());
            }
        }
        Service()(Owned);
        await withRequestScope({ context }, async ({ serviceScope }) => {
            new ServiceScope(serviceScope, [Owned], { ownerRouteId: 'layout' });
        });
        expect(observed).toEqual([context]);
    });
});

describe('controlledAsync (RT-29)', () => {
    it('resolves once and reports settlement', async () => {
        const deferred = controlledAsync<string>();
        expect(deferred.settled).toBe(false);
        deferred.resolve('value');
        expect(deferred.settled).toBe(true);
        await expect(deferred.promise).resolves.toBe('value');
        // Late resolve/reject calls after settlement are ignored.
        deferred.reject(new Error('too late'));
        await expect(deferred.promise).resolves.toBe('value');
    });

    it('cancel aborts the shared signal and rejects', async () => {
        const deferred = controlledAsync<number>();
        const aborted = new Promise<boolean>(resolve =>
            deferred.signal.addEventListener('abort', () => resolve(true)));
        deferred.cancel();
        expect(await aborted).toBe(true);
        await expect(deferred.promise).rejects.toThrow('cancelled');
    });
});
