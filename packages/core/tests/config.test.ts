// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config, env, setConfigStoreGetter, type ConfigStore } from '../src/shared/config';

// ---------------------------------------------------------------------------
// Mock the `isServer` flag so we can exercise both branches (mirrors i18n.test).
// ---------------------------------------------------------------------------
vi.mock('../src/shared/environment', () => ({
    get isServer() {
        return (globalThis as any).__MOCK_IS_SERVER ?? false;
    },
}));

function setEnv(server: boolean) {
    (globalThis as any).__MOCK_IS_SERVER = server;
}

const sampleStore: ConfigStore = {
    env: { DB_HOST: 'db.example.com', DB_PORT: 5432, EMPTY: '' },
    config: {
        app: { name: 'My App', env: 'production' },
        database: {
            driver: 'mysql',
            connections: {
                mysql: { host: 'localhost', port: 3306 },
            },
        },
    },
};

beforeEach(() => {
    setConfigStoreGetter(null);
    setEnv(false);
});

afterEach(() => {
    setConfigStoreGetter(null);
    setEnv(false);
});

// ---------------------------------------------------------------------------
// config()
// ---------------------------------------------------------------------------
describe('config()', () => {
    it('returns default when no store is active (client / outside request)', () => {
        setEnv(false);
        expect(config('app.name')).toBeUndefined();
        expect(config('app.name', 'Fallback')).toBe('Fallback');
    });

    it('returns default when on server but no store getter is wired', () => {
        setEnv(true);
        expect(config('app.name', 'Fallback')).toBe('Fallback');
    });

    it('resolves a top-level key', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(config('app.name')).toBe('My App');
        expect(config('app.env')).toBe('production');
    });

    it('resolves a deeply nested dotted path', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(config('database.connections.mysql.host')).toBe('localhost');
        expect(config('database.connections.mysql.port')).toBe(3306);
    });

    it('returns the default when the key is missing', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(config('app.missing')).toBeUndefined();
        expect(config('app.missing', 'default')).toBe('default');
    });

    it('returns the default when an intermediate segment is not an object', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        // 'database.driver' is a string, so descending further should fail.
        expect(config('database.driver.nested', 'fallback')).toBe('fallback');
    });

    it('returns the default when walking into a null segment', () => {
        setEnv(true);
        const storeWithNull: ConfigStore = {
            env: {},
            config: { app: null as unknown },
        };
        setConfigStoreGetter(() => storeWithNull);
        expect(config('app.name', 'fallback')).toBe('fallback');
    });
});

// ---------------------------------------------------------------------------
// env()
// ---------------------------------------------------------------------------
describe('env()', () => {
    it('returns empty string (no default) when no store is active', () => {
        setEnv(false);
        expect(env('DB_HOST')).toBe('');
    });

    it('returns the default when no store is active', () => {
        setEnv(false);
        expect(env('DB_HOST', 'fallback')).toBe('fallback');
    });

    it('reads a binding value and coerces to string', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(env('DB_HOST')).toBe('db.example.com');
        expect(env('DB_PORT')).toBe('5432'); // number coerced to string
    });

    it('returns the default when the binding is unset', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(env('UNSET_KEY', 'fallback')).toBe('fallback');
    });

    it('returns empty string when binding is unset and no default given', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(env('UNSET_KEY')).toBe('');
    });

    it('returns empty string default when binding is explicitly empty string', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        // EMPTY is '' — present but falsy; should return '' (not a default).
        expect(env('EMPTY', 'fallback')).toBe('');
    });

    it('returns default when binding is null', () => {
        setEnv(true);
        const storeWithNull: ConfigStore = {
            env: { NULL_KEY: null } as Record<string, unknown>,
            config: {},
        };
        setConfigStoreGetter(() => storeWithNull);
        expect(env('NULL_KEY', 'fallback')).toBe('fallback');
    });
});

// ---------------------------------------------------------------------------
// setConfigStoreGetter injection
// ---------------------------------------------------------------------------
describe('setConfigStoreGetter', () => {
    it('can be cleared by passing null', () => {
        setEnv(true);
        setConfigStoreGetter(() => sampleStore);
        expect(config('app.name')).toBe('My App');
        setConfigStoreGetter(null);
        expect(config('app.name', 'fallback')).toBe('fallback');
    });

    it('reflects store changes across calls (per-request isolation simulation)', () => {
        setEnv(true);
        const storeA: ConfigStore = { env: {}, config: { app: { name: 'App A' } } };
        const storeB: ConfigStore = { env: {}, config: { app: { name: 'App B' } } };
        let current = storeA;
        setConfigStoreGetter(() => current);

        expect(config('app.name')).toBe('App A');
        current = storeB;
        expect(config('app.name')).toBe('App B');
    });
});
