// @vitest-environment node
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { Component, Page, Server, State, Store } from '../src/shared/decorators';

// Custom state providers were removed in favour of `@Page({ scope })`. The
// `@ts-expect-error` lines are verified by the package type check
// (`node scripts/typecheck.mjs`), which includes this test directory.
describe('removed state providers', () => {
    it('rejects the providers option at compile time and at runtime', () => {
        const provider = { getConnectionTarget: () => 'user:1' };
        // @ts-expect-error — PageOptions.providers was removed.
        expect(() => Page({ transport: 'durable-object', providers: { session: provider } })).toThrow(
            expect.objectContaining({ code: 'COSSACK_PROVIDERS_REMOVED', message: expect.stringContaining('scope') }));
        // @ts-expect-error — Component shares the page options.
        expect(() => Component({ providers: {} })).toThrow(expect.objectContaining({ code: 'COSSACK_PROVIDERS_REMOVED' }));
    });

    it('rejects the provider option of @State, @Store and @Server at compile time', () => {
        class Live {
            // @ts-expect-error — StateOptions.provider was removed.
            @State({ provider: 'session' }) count = 0;
            // @ts-expect-error — StoreOptions.provider was removed.
            @Store({ provider: 'session' }) form = { name: '' };
            // @ts-expect-error — ServerOptions.provider was removed.
            @Server({ provider: 'session' }) increment() { this.count++; }
            @State({ channel: 'feeds' }) feed = 0;
            @Server({ channel: 'feeds' }) bump() { this.feed++; }
        }
        // Metadata records only the channel; there is no provider to select.
        expect(Reflect.getOwnMetadata('cossack:state', Live).feed).toEqual({ channel: 'feeds' });
        expect(Reflect.getOwnMetadata('cossack:state', Live).count).not.toHaveProperty('provider');
        expect(Reflect.getOwnMetadata('cossack:store', Live).form).not.toHaveProperty('provider');
        expect(Reflect.getOwnMetadata('cossack:server-methods', Live).bump).toEqual({ channel: 'feeds' });
        expect(Reflect.getOwnMetadata('cossack:server-methods', Live).increment).not.toHaveProperty('provider');
    });

    it('no longer exports StateProvider or PageStateProvider', () => {
        expect(core).not.toHaveProperty('StateProvider');
        expect(core).not.toHaveProperty('PageStateProvider');
        // @ts-expect-error — the StateProvider export was removed.
        type Removed = core.StateProvider;
    });
});
