import { describe, expect, it, vi } from 'vitest';
import { ConfigRequirementError, prepareConfigStore, requireConfigVariable, type ConfigRequirements } from '../src/config';

/** Count how often normalization inspects a metadata object (each read lists its keys). */
function counted<T extends object>(value: T, reads: { count: number }): T {
    return new Proxy(value, { ownKeys(target) { reads.count++; return Reflect.ownKeys(target); } });
}

const context = { runtime: 'cloudflare' as const };

describe('config requirement normalization across requests', () => {
    it('normalizes static requirements once while values and factories stay per request', () => {
        const reads = { count: 0 };
        const requirements: Record<string, ConfigRequirements> = {
            app: counted({ variables: { PORT: { type: 'number', coerce: true }, NAME: { type: 'string', required: false } } }, reads),
            database: counted({ bindings: { DB: { kind: 'd1' } } }, reads),
        };
        const factory = vi.fn(() => ({ port: requireConfigVariable('PORT', 'number') }));
        const db = { prepare() {}, batch() {} };
        const first = prepareConfigStore({ app: factory }, { PORT: '81', DB: db }, { requirements, context });
        const afterFirst = reads.count;
        expect(afterFirst).toBeGreaterThan(0);
        const second = prepareConfigStore({ app: factory }, { PORT: '82', DB: db }, { requirements, context });
        expect(() => prepareConfigStore({ app: factory }, { PORT: 'not-a-number', DB: db }, { requirements, context }))
            .toThrow(ConfigRequirementError);
        expect(() => prepareConfigStore({ app: factory }, { PORT: '83' }, { requirements, context }))
            .toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIRED_MISSING', requirementName: 'DB' }));
        // Metadata was read for the first request only.
        expect(reads.count).toBe(afterFirst);
        // Values, parsed variables and factory results are each request's own.
        expect(first.variables).toEqual({ PORT: 81 });
        expect(second.variables).toEqual({ PORT: 82 });
        expect(first.config.app).toEqual({ port: 81 });
        expect(second.config.app).toEqual({ port: 82 });
        expect(second.env.DB).toBe(db);
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('plans each runtime separately', () => {
        const requirements = { cache: { bindings: { CACHE: { kind: 'kv', runtimes: ['cloudflare'] } } } } as const;
        expect(() => prepareConfigStore({}, {}, { requirements, context })).toThrow(ConfigRequirementError);
        expect(prepareConfigStore({}, {}, { requirements, context: { runtime: 'node' } }).variables).toEqual({});
        expect(() => prepareConfigStore({}, {}, { requirements, context })).toThrow(ConfigRequirementError);
    });

    it('re-plans when a config file metadata object is replaced or removed', () => {
        const requirements: Record<string, ConfigRequirements> = { app: { variables: { PORT: { type: 'number' } } } };
        expect(() => prepareConfigStore({}, {}, { requirements, context })).toThrow(ConfigRequirementError);
        requirements.app = { variables: { PORT: { type: 'number', required: false } } };
        expect(prepareConfigStore({}, {}, { requirements, context }).variables).toEqual({});
        requirements.mail = { variables: { MAIL_FROM: { type: 'string' } } };
        expect(() => prepareConfigStore({}, {}, { requirements, context })).toThrow(expect.objectContaining({ requirementName: 'MAIL_FROM' }));
        delete requirements.mail;
        expect(prepareConfigStore({}, {}, { requirements, context }).variables).toEqual({});
    });

    it('still reports invalid metadata on every request without running its accessors', () => {
        let calls = 0;
        const requirements = Object.defineProperty({}, 'app', { enumerable: true, get() { calls++; return {}; } });
        for (let request = 0; request < 2; request++) {
            expect(() => prepareConfigStore({}, {}, { requirements, context }))
                .toThrow(expect.objectContaining({ code: 'COSSACK_CONFIG_REQUIREMENTS_INVALID' }));
        }
        expect(calls).toBe(0);
    });
});
