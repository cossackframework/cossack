import { describe, expect, it, vi } from 'vitest';
import {
    binding, config, ConfigBindingError, env, prepareConfigStore,
    requireBinding, requireEnv, runWithConfig, type ConfigStore, type EnvFunction,
} from '../src/config';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

const outerStore: ConfigStore = {
    env: { APP_NAME: 'outer', OUTER_ONLY: 'outer-only', DB: { id: 'outer' } },
    config: { app: { name: 'outer' } },
};

describe('configuration factory preparation scope', () => {
    it('gives imported and injected helpers the selected environment without inheriting an outer scope', () => {
        const db = { id: 'selected' };
        runWithConfig(outerStore, () => {
            const store = prepareConfigStore({
                app: ({ env: injected }: { env: EnvFunction }) => ({
                    name: requireEnv('APP_NAME'),
                    injected: injected('APP_NAME'),
                    optional: env('OPTIONAL', 'fallback'),
                    db: requireBinding('DB'),
                    optionalBinding: binding('ABSENT'),
                    inherited: binding('OUTER_ONLY'),
                    priorConfig: config('app.name', 'fresh'),
                }),
            }, { APP_NAME: 'selected', DB: db });
            expect(store.config.app).toEqual({
                name: 'selected', injected: 'selected', optional: 'fallback', db,
                optionalBinding: undefined, inherited: undefined, priorConfig: 'fresh',
            });
            expect(env('APP_NAME')).toBe('outer');
            expect(config('app.name')).toBe('outer');
        });
        expect(binding('DB')).toBeUndefined();
    });

    it.each(['environment', 'binding'] as const)('stops preparation on a missing required %s and reports names without values', (kind) => {
        const laterFactory = vi.fn(() => ({ name: 'later' }));
        const downstream = vi.fn();
        let caught: unknown;
        runWithConfig(outerStore, () => {
            try {
                const store = prepareConfigStore({
                    app: () => ({ name: kind === 'environment' ? requireEnv('MISSING') : requireBinding('MISSING') }),
                    later: laterFactory,
                }, { API_TOKEN: 'secret-sentinel-value', DB: { credential: 'object-sentinel-value' } });
                runWithConfig(store, downstream);
            } catch (error) { caught = error; }
            expect(env('APP_NAME')).toBe('outer');
            expect(config('app.name')).toBe('outer');
        });
        expect(caught).toBeInstanceOf(ConfigBindingError);
        const error = caught as ConfigBindingError;
        expect(error.code).toBe('COSSACK_BINDING_MISSING');
        expect(error.bindingName).toBe('MISSING');
        expect(error.message).toContain('API_TOKEN');
        expect(error.message).toContain('DB');
        expect(error.message).not.toContain('secret-sentinel-value');
        expect(error.message).not.toContain('object-sentinel-value');
        expect(error.message).not.toContain('OUTER_ONLY');
        expect(laterFactory).not.toHaveBeenCalled();
        expect(downstream).not.toHaveBeenCalled();
        expect(env('APP_NAME', 'outside')).toBe('outside');
    });

    it('isolates actual interleaved asynchronous requests using prepared stores', async () => {
        const firstEntered = deferred();
        const secondEntered = deferred();
        const firstRead = deferred();
        const secondRead = deferred();
        const factory = { app: () => ({ name: requireEnv('APP_NAME'), db: requireBinding('DB') }) };
        const firstDb = { id: 'first' };
        const secondDb = { id: 'second' };
        const first = prepareConfigStore(factory, { APP_NAME: 'first', DB: firstDb });
        const second = prepareConfigStore(factory, { APP_NAME: 'second', DB: secondDb });
        await Promise.all([
            runWithConfig(first, async () => {
                firstEntered.resolve();
                await secondEntered.promise;
                expect(config('app.name')).toBe('first');
                expect(requireBinding('DB')).toBe(firstDb);
                firstRead.resolve();
                await secondRead.promise;
                expect(requireEnv('APP_NAME')).toBe('first');
            }),
            runWithConfig(second, async () => {
                secondEntered.resolve();
                await firstEntered.promise;
                await firstRead.promise;
                expect(config('app.name')).toBe('second');
                expect(requireBinding('DB')).toBe(secondDb);
                secondRead.resolve();
                await Promise.resolve();
                expect(requireEnv('APP_NAME')).toBe('second');
            }),
        ]);
        expect(config('app.name')).toBeUndefined();
        expect(binding('DB')).toBeUndefined();
    });
});
