// tests/config.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { config, env, runWithConfig, buildConfig, type ConfigStore, type EnvFunction } from '../src/config';

// Note: config() now reads directly from AsyncLocalStorage (no isServer flag,
// no setConfigStoreGetter injection). Tests use runWithConfig() to scope a
// store, and call config()/env() outside any scope to test the no-store path.

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

// ---------------------------------------------------------------------------
// config()
// ---------------------------------------------------------------------------
describe('config()', () => {
    it('returns default when no store is active (outside a request scope)', () => {
        expect(config('app.name')).toBeUndefined();
        expect(config('app.name', 'Fallback')).toBe('Fallback');
    });

    it('resolves a top-level key', () => {
        const result = runWithConfig(sampleStore, () => {
            expect(config('app.name')).toBe('My App');
            expect(config('app.env')).toBe('production');
            return 'done';
        });
        expect(result).toBe('done');
    });

    it('resolves a deeply nested dotted path', () => {
        runWithConfig(sampleStore, () => {
            expect(config('database.connections.mysql.host')).toBe('localhost');
            expect(config('database.connections.mysql.port')).toBe(3306);
        });
    });

    it('returns the default when the key is missing', () => {
        runWithConfig(sampleStore, () => {
            expect(config('app.missing')).toBeUndefined();
            expect(config('app.missing', 'default')).toBe('default');
        });
    });

    it('returns the default when an intermediate segment is not an object', () => {
        runWithConfig(sampleStore, () => {
            // 'database.driver' is a string, so descending further should fail.
            expect(config('database.driver.nested', 'fallback')).toBe('fallback');
        });
    });

    it('returns the default when walking into a null segment', () => {
        const storeWithNull: ConfigStore = {
            env: {},
            config: { app: null as unknown },
        };
        runWithConfig(storeWithNull, () => {
            expect(config('app.name', 'fallback')).toBe('fallback');
        });
    });

    it('values are isolated per runWithConfig scope', () => {
        const storeA: ConfigStore = { env: {}, config: { app: { name: 'App A' } } };
        const storeB: ConfigStore = { env: {}, config: { app: { name: 'App B' } } };

        runWithConfig(storeA, () => {
            expect(config('app.name')).toBe('App A');
        });
        runWithConfig(storeB, () => {
            expect(config('app.name')).toBe('App B');
        });
    });
});

// ---------------------------------------------------------------------------
// env()
// ---------------------------------------------------------------------------
describe('env()', () => {
    it('returns empty string (no default) when no store is active', () => {
        expect(env('DB_HOST')).toBe('');
    });

    it('returns the default when no store is active', () => {
        expect(env('DB_HOST', 'fallback')).toBe('fallback');
    });

    it('reads a binding value and coerces to string', () => {
        runWithConfig(sampleStore, () => {
            expect(env('DB_HOST')).toBe('db.example.com');
            expect(env('DB_PORT')).toBe('5432'); // number coerced to string
        });
    });

    it('returns the default when the binding is unset', () => {
        runWithConfig(sampleStore, () => {
            expect(env('UNSET_KEY', 'fallback')).toBe('fallback');
        });
    });

    it('returns empty string when binding is unset and no default given', () => {
        runWithConfig(sampleStore, () => {
            expect(env('UNSET_KEY')).toBe('');
        });
    });

    it('returns empty string default when binding is explicitly empty string', () => {
        runWithConfig(sampleStore, () => {
            // EMPTY is '' — present but falsy; should return '' (not a default).
            expect(env('EMPTY', 'fallback')).toBe('');
        });
    });

    it('returns default when binding is null', () => {
        const storeWithNull: ConfigStore = {
            env: { NULL_KEY: null } as Record<string, unknown>,
            config: {},
        };
        runWithConfig(storeWithNull, () => {
            expect(env('NULL_KEY', 'fallback')).toBe('fallback');
        });
    });
});

// ---------------------------------------------------------------------------
// Type-level tests (compile-time only — validated by the compiler, not runtime)
// ---------------------------------------------------------------------------
describe('config() type inference', () => {
    it('infers types from the CossackConfigRegistry augmentation', () => {
        // These assignments are validated by the compiler. If the augmentation
        // from src/config/app.ts is working, config('app.name') infers string,
        // config('app.debug') infers boolean, etc. Without augmentation, these
        // would fail because the return type would be `unknown`.
        runWithConfig(sampleStore, () => {
            const _name: string = config('app.name');
            const _debug: boolean = config('app.debug');
            const _url: string = config('app.url');
            const _locale: string = config('app.locale');
            void _name;
            void _debug;
            void _url;
            void _locale;
        });
    });
});

// ---------------------------------------------------------------------------
// buildConfig()
// ---------------------------------------------------------------------------
describe('buildConfig()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('evaluates each factory with the env function', () => {
        const envFn = (key: string, def: string = '') => (key === 'APP_NAME' ? 'Storm' : def);
        const built = buildConfig(
            {
                app: ({ env }: { env: EnvFunction }) => ({ name: env('APP_NAME', 'Fallback') }),
                db: ({ env }: { env: EnvFunction }) => ({ host: env('DB_HOST', 'localhost') }),
            },
            envFn as any,
        );
        expect(built).toEqual({ app: { name: 'Storm' }, db: { host: 'localhost' } });
    });

    it('skips non-function defaults (e.g. a constants file) instead of throwing', () => {
        // Regression: a file in src/config/ that exports only constants (no
        // default factory) must not crash the request. buildConfig skips it.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const envFn = (key: string, def: string = '') => def;
        const built = buildConfig(
            {
                permissions: undefined, // simulates a constants-only module (no default export)
                app: ({ env }: { env: EnvFunction }) => ({ name: env('APP_NAME', 'My App') }),
            },
            envFn as any,
        );
        expect(built).toEqual({ app: { name: 'My App' } });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/src\/config\/permissions\.ts/);
    });

    it('returns an empty object for no factories', () => {
        expect(buildConfig({}, (() => '') as any)).toEqual({});
    });
});
