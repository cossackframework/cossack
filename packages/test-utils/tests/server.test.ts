import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { getRequestContext } from '@cossackframework/core';
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
