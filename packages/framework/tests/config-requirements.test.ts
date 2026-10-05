import { describe, expect, it } from 'vitest';
import { checkConfigRequirements, normalizeConfigRequirements, type ConfigRequirements } from '../src/config-requirements';

const runtime = { runtime: 'cloudflare', environment: 'staging' } as const;
const check = (requirements: ConfigRequirements, values: Record<string, unknown> = {}) =>
    checkConfigRequirements({ app: requirements }, values, runtime);

describe('config requirement metadata', () => {
    it('normalizes defaults without mutating source metadata', () => {
        const source = { variables: { PORT: { type: 'number' } }, bindings: { DB: { kind: 'd1' } } };
        expect(normalizeConfigRequirements(source)).toEqual({
            variables: { PORT: { type: 'number', required: true, coerce: false, secret: false } },
            bindings: { DB: { kind: 'd1', required: true } },
        });
        expect(source.variables.PORT).toEqual({ type: 'number' });
    });

    it.each([null, [], { variables: [] }, { variables: { PORT: { type: 'integer' } } },
        { bindings: { DB: { kind: 'database' } } }, { variables: { PORT: { type: 'number', coerce: 'yes' } } },
        { variables: { PORT: { type: 'number', runtimes: ['imaginary'] } } }])('rejects malformed metadata: %j', value => {
        expect(() => normalizeConfigRequirements(value)).toThrow();
    });

    it('rejects accessor metadata without executing it', () => {
        let calls = 0;
        const value = Object.defineProperty({}, 'variables', { enumerable: true, get() { calls++; return {}; } });
        expect(() => normalizeConfigRequirements(value)).toThrow();
        expect(calls).toBe(0);
    });
    it('rejects nested accessor metadata without executing it', () => {
        let calls = 0;
        const runtimes = Object.defineProperty([], '0', { enumerable: true, get() { calls++; return 'cloudflare'; } });
        expect(() => normalizeConfigRequirements({ variables: { TOKEN: { type: 'string', runtimes } } })).toThrow();
        expect(calls).toBe(0);
    });
    it('rejects customized runtime arrays without running their iterator', () => {
        let calls = 0;
        const runtimes = ['cloudflare'];
        runtimes[Symbol.iterator] = function* (): Generator<string, undefined> { calls++; yield 'cloudflare'; return undefined; };
        expect(() => normalizeConfigRequirements({ variables: { TOKEN: { type: 'string', runtimes } } })).toThrow();
        expect(calls).toBe(0);
    });
});

describe('runtime config requirements', () => {
    it('checks all required names before returning typed variables', () => {
        const result = check({ variables: { PORT: { type: 'number' }, FLAG: { type: 'boolean' } }, bindings: { DB: { kind: 'd1' } } });
        expect(result.diagnostics.map(item => item.name).sort()).toEqual(['DB', 'FLAG', 'PORT']);
        expect(result.diagnostics.every(item => item.runtime === 'cloudflare' && item.environment === 'staging')).toBe(true);
    });

    it('skips absent optional variables and bindings', () => {
        const result = check({ variables: { PORT: { type: 'number', required: false } }, bindings: { DB: { kind: 'd1', required: false } } });
        expect(result.diagnostics).toEqual([]);
        expect(result.variables).toEqual({});
    });

    it('keeps correctly typed values and reports declared types', () => {
        const result = check({ variables: { PORT: { type: 'number' }, FLAG: { type: 'boolean' }, TITLE: { type: 'string' } } }, { PORT: 8080, FLAG: false, TITLE: 'test' });
        expect(result.diagnostics).toEqual([]);
        expect(result.variables).toEqual({ PORT: 8080, FLAG: false, TITLE: 'test' });
        expect(result.variableTypes).toEqual({ PORT: 'number', FLAG: 'boolean', TITLE: 'string' });
    });

    it.each(['8080', null, true, Infinity, NaN, {}])('rejects incorrect number values without coercion: %s', PORT => {
        expect(check({ variables: { PORT: { type: 'number' } } }, { PORT }).diagnostics).toHaveLength(1);
    });

    it.each([' 12.5 ', '-1', '0', '1e3'])('coerces finite decimal numbers: %s', PORT => {
        const result = check({ variables: { PORT: { type: 'number', coerce: true } } }, { PORT });
        expect(result.diagnostics).toEqual([]);
        expect(result.variables.PORT).toBe(Number(PORT));
    });

    it.each(['', ' ', '0x10', 'Infinity', 'NaN', '12px', '1e999', true, null])('rejects unsafe numeric coercion: %s', PORT => {
        expect(check({ variables: { PORT: { type: 'number', coerce: true } } }, { PORT }).diagnostics).toHaveLength(1);
    });

    it.each([[true, true], [false, false], ['true', true], ['false', false], ['1', true], ['0', false], [1, true], [0, false]])('coerces supported boolean %s', (FLAG, expected) => {
        const result = check({ variables: { FLAG: { type: 'boolean', coerce: true } } }, { FLAG });
        expect(result.diagnostics).toEqual([]);
        expect(result.variables.FLAG).toBe(expected);
    });

    it.each(['yes', 'FALSE', '', 2, null, {}])('rejects unsafe boolean coercion: %s', FLAG => {
        expect(check({ variables: { FLAG: { type: 'boolean', coerce: true } } }, { FLAG }).diagnostics).toHaveLength(1);
    });

    it('never includes rejected values or secret values in diagnostics', () => {
        const sentinel = 'secret-value-sentinel-never-print';
        const result = check({ variables: { TOKEN: { type: 'number', secret: true } }, bindings: { DB: { kind: 'd1' } } }, { TOKEN: sentinel, DB: { password: sentinel } });
        expect(result.diagnostics.map(item => item.name).sort()).toEqual(['DB', 'TOKEN']);
        expect(JSON.stringify(result.diagnostics)).not.toContain(sentinel);
    });

    it('applies runtime filters, including explicit SSG opt-out', () => {
        const collection = { app: { variables: { TOKEN: { type: 'string', runtimes: ['cloudflare'] } }, bindings: { DB: { kind: 'd1', runtimes: ['cloudflare'] } } } } as const;
        expect(checkConfigRequirements(collection, {}, { runtime: 'ssg' }).diagnostics).toEqual([]);
        expect(checkConfigRequirements(collection, {}, runtime).diagnostics).toHaveLength(2);
    });

    it('rejects active Cloudflare-only bindings outside Cloudflare', () => {
        expect(checkConfigRequirements({ app: { bindings: { DB: { kind: 'd1' } } } }, { DB: { prepare() {}, batch() {} } }, { runtime: 'node' }).diagnostics).toHaveLength(1);
    });

    it.each([
        ['d1', { prepare() {}, batch() {} }], ['kv', { get() {}, put() {}, delete() {} }],
        ['r2', { get() {}, put() {}, delete() {}, head() {} }], ['durable-object', { idFromName() {}, get() {} }],
        ['service', { fetch() {} }], ['object', {}], ['object', () => {}],
    ] as const)('checks the %s binding shape', (kind, value) => {
        expect(check({ bindings: { RESOURCE: { kind } } }, { RESOURCE: value }).diagnostics).toEqual([]);
        expect(check({ bindings: { RESOURCE: { kind } } }, { RESOURCE: 'not-an-object' }).diagnostics).toHaveLength(1);
    });

    it('combines compatible requirements and promotes required status', () => {
        const result = checkConfigRequirements({ a: { variables: { PORT: { type: 'number', required: false } } }, b: { variables: { PORT: { type: 'number', required: true } } } }, {}, runtime);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].name).toBe('PORT');
    });

    it.each([
        { a: { variables: { PORT: { type: 'number' } } }, b: { variables: { PORT: { type: 'string' } } } },
        { a: { variables: { PORT: { type: 'number' } } }, b: { variables: { PORT: { type: 'number', coerce: true } } } },
        { a: { bindings: { DB: { kind: 'd1' } } }, b: { bindings: { DB: { kind: 'kv' } } } },
    ] satisfies Record<string, ConfigRequirements>[])('reports conflicting declarations by name', collection => {
        const result = checkConfigRequirements(collection, {}, runtime);
        expect(result.diagnostics.some(item => item.code.includes('CONFLICT'))).toBe(true);
    });
});

describe('declaration-only config checks', () => {
    it('checks selected declarations without requiring runtime binding objects', () => {
        const result = checkConfigRequirements({ app: { variables: { PORT: { type: 'number', coerce: true }, TOKEN: { type: 'string', secret: true } }, bindings: { DB: { kind: 'd1' } } } }, { PORT: '8080' }, { ...runtime, mode: 'declarations', bindingKinds: { DB: 'd1' } });
        expect(result.diagnostics).toEqual([]);
        expect(result.variables.PORT).toBe(8080);
        expect(result.unverifiedSecrets).toEqual(['TOKEN']);
    });

    it('accepts declared secret names without claiming availability', () => {
        const result = checkConfigRequirements({ app: { variables: { TOKEN: { type: 'string', secret: true } } } }, {}, { ...runtime, mode: 'declarations', secretNames: ['TOKEN'] });
        expect(result.diagnostics).toEqual([]);
        expect(result.unverifiedSecrets).toEqual(['TOKEN']);
    });

    it('ignores inherited binding declarations', () => {
        const result = checkConfigRequirements({ app: { bindings: { DB: { kind: 'd1' } } } }, {}, {
            ...runtime, mode: 'declarations', bindingKinds: Object.create({ DB: 'd1' }),
        });
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].name).toBe('DB');
    });

    it('does not inherit another environment binding declaration', () => {
        const collection = { app: { bindings: { DB: { kind: 'd1' } } } } as const;
        expect(checkConfigRequirements(collection, {}, { ...runtime, mode: 'declarations', bindingKinds: { DB: 'd1' } }).diagnostics).toEqual([]);
        const absent = checkConfigRequirements(collection, {}, { runtime: 'cloudflare', environment: 'production', mode: 'declarations', bindingKinds: {} });
        expect(absent.diagnostics).toHaveLength(1);
        expect(absent.diagnostics[0].environment).toBe('production');
    });
});
