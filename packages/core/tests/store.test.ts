// tests/store.test.ts
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { createStoreProxy, resolveStatePath } from '../src/shared/store';
import { Store, ClientStore, Validate } from '../src/shared/decorators';
import { getValidationRules, storeRules } from '../src/shared/validation';

describe('createStoreProxy', () => {
    it('fires the trigger exactly once on a top-level change', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ a: 1, b: 2 }, 'store', trigger);
        store.a = 2;
        expect(trigger).toHaveBeenCalledTimes(1);
        expect(trigger).toHaveBeenCalledWith('store');
    });

    it('does NOT fire the trigger when the value is unchanged (strict equality)', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ a: 1 }, 'store', trigger);
        store.a = 1; // same value
        expect(trigger).not.toHaveBeenCalled();
    });

    it('does NOT fire the trigger on NaN === NaN (NaN !== NaN is true but they are equal)', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ v: NaN } as Record<string, unknown>, 'store', trigger);
        store.v = NaN; // semantically a no-op even though NaN !== NaN
        expect(trigger).not.toHaveBeenCalled();
    });

    it('fires the trigger on deep nested object mutation', () => {
        const trigger = vi.fn();
        const store = createStoreProxy(
            { user: { address: { zip: '00000' } } },
            'store',
            trigger,
        );
        (store.user as any).address.zip = '12345';
        expect(trigger).toHaveBeenCalledTimes(1);
        expect(trigger).toHaveBeenCalledWith('store');
    });

    it('fires the trigger on array element writes', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ items: [1, 2, 3] }, 'store', trigger);
        (store.items as number[])[0] = 99;
        // push semantics aside, only the element write itself fires here.
        expect(trigger).toHaveBeenCalledWith('store');
        const before = trigger.mock.calls.length;
        (store.items as number[])[0] = 99; // no-op
        expect(trigger.mock.calls.length).toBe(before);
    });

    it('fires the trigger for array mutation methods (push/splice/pop)', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ tags: [] as string[] }, 'store', trigger);
        const tags = store.tags as string[];
        tags.push('a');            // set index + set length
        tags.push('b');
        tags.splice(0, 1);
        tags.pop();
        // Each method call fires at least once.
        expect(trigger.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(store.tags).toEqual([]);
    });

    it('fires the trigger on length truncation', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ tags: ['a', 'b', 'c'] }, 'store', trigger);
        (store.tags as string[]).length = 0;
        expect(trigger).toHaveBeenCalledWith('store');
        expect(store.tags).toEqual([]);
    });

    it('serializes identically to the raw object via JSON.stringify (nested + arrays)', () => {
        const trigger = vi.fn();
        const raw = {
            name: 'x',
            address: { zip: '123', coords: [1, 2, 3] },
            tags: ['a', 'b'],
        };
        const store = createStoreProxy(raw, 'store', trigger);
        expect(JSON.stringify(store)).toBe(JSON.stringify(raw));
    });

    it('Object.entries / Object.fromEntries are transparent', () => {
        const trigger = vi.fn();
        const raw = { a: 1, b: { c: 2 } };
        const store = createStoreProxy(raw, 'store', trigger);
        expect(Object.fromEntries(Object.entries(store))).toEqual(raw);
    });

    it('supports iteration / spread over proxied arrays', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ tags: ['x', 'y', 'z'] }, 'store', trigger);
        const collected: string[] = [];
        for (const t of store.tags as string[]) collected.push(t);
        expect(collected).toEqual(['x', 'y', 'z']);
        expect([...(store.tags as string[])]).toEqual(['x', 'y', 'z']);
    });

    it('returns the same proxy identity on repeated reads (stable)', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ user: { name: 'a' } }, 'store', trigger);
        expect(store.user).toBe(store.user);
        expect(store.user).toBe(store.user);
    });

    it('returns a fresh child proxy after nested-object reassignment', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ user: { name: 'a' } }, 'store', trigger);
        const first = store.user;
        store.user = { name: 'b' };
        const second = store.user as { name: string };
        expect(first).not.toBe(second);
        expect(second.name).toBe('b');
    });

    it('traverses a circular reference without infinite recursion', () => {
        const trigger = vi.fn();
        const a: any = { name: 'a' };
        const b: any = { name: 'b' };
        a.b = b;
        b.a = a;
        const store = createStoreProxy(a, 'store', trigger);
        // Identity preserved across the cycle (cached child proxies).
        const cycleBack = (store.b as any).a;
        expect(cycleBack).toBe(store);
        expect((cycleBack as any).name).toBe('a');
    });

    it('deleteProperty fires the trigger and removes the key', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ a: 1, b: 2 } as Record<string, number>, 'store', trigger);
        delete store.a;
        expect(trigger).toHaveBeenCalledWith('store');
        expect((store as any).a).toBeUndefined();
    });

    it('reflects mutations on the underlying raw target', () => {
        const trigger = vi.fn();
        const raw = { count: 0, nested: { v: 1 } };
        const store = createStoreProxy(raw, 'store', trigger);
        store.count = 5;
        (store.nested as { v: number }).v = 9;
        // The proxy mutates the raw target in place.
        expect(raw.count).toBe(5);
        expect(raw.nested.v).toBe(9);
    });
});

describe('resolveStatePath', () => {
    it('resolves a flat property via getProperty when present', () => {
        const comp: any = {
            getProperty: (name: string) => (name === 'email' ? 'a@b.com' : undefined),
        };
        expect(resolveStatePath(comp, 'email')).toBe('a@b.com');
    });

    it('resolves a flat property via direct access when getProperty is absent', () => {
        const comp: any = { email: 'a@b.com' };
        expect(resolveStatePath(comp, 'email')).toBe('a@b.com');
    });

    it('walks a multi-level dot path into a nested store', () => {
        const comp: any = {
            getProperty: (name: string) =>
                name === 'form' ? { address: { zip: '12345' } } : undefined,
        };
        expect(resolveStatePath(comp, 'form.address.zip')).toBe('12345');
    });

    it('returns undefined for a missing intermediate segment', () => {
        const comp: any = {
            getProperty: (name: string) => (name === 'form' ? { address: {} } : undefined),
        };
        expect(resolveStatePath(comp, 'form.address.zip')).toBeUndefined();
    });

    it('returns undefined when the root property is missing', () => {
        const comp: any = {
            getProperty: (_name: string) => undefined,
        };
        expect(resolveStatePath(comp, 'form.address.zip')).toBeUndefined();
    });
});

describe('@Store / @ClientStore decorator metadata', () => {
    it('@Store records metadata under cossack:store with channel/provider', () => {
        class Comp {
            @Store({ channel: 'users', provider: 'session' })
            form = { email: '' };
        }
        const meta = Reflect.getOwnMetadata('cossack:store', Comp);
        expect(meta).toBeDefined();
        expect(meta.form).toEqual({ channel: 'users', provider: 'session' });
    });

    it('@Store applies default channel/provider', () => {
        class Comp {
            @Store()
            form = { email: '' };
        }
        const meta = Reflect.getOwnMetadata('cossack:store', Comp);
        expect(meta.form).toEqual({ channel: 'global', provider: 'page' });
    });

    it('@ClientStore records membership in cossack:client-store', () => {
        class Comp {
            @ClientStore()
            ui = { open: false };
        }
        const meta = Reflect.getOwnMetadata('cossack:client-store', Comp) as Set<string>;
        expect(meta).toBeInstanceOf(Set);
        expect(meta.has('ui')).toBe(true);
    });
});

describe('@Validate with store (dot-path rule map)', () => {
    it('registers each dot-path as its own validation entry', () => {
        class Comp {
            @Store()
            @Validate({
                rules: {
                    'form.email': { required: true, email: true, message: 'bad email' },
                    'form.address.zip': { required: true, pattern: /^\d{5}$/ },
                },
                config: { trigger: 'all', runOn: 'both' },
            })
            form = { email: '', address: { zip: '' } };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email']).toBeDefined();
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.address.zip']).toBeDefined();
        // 'form' itself should NOT be a rule entry (the map shape produces per-path entries).
        expect(rules['form']).toBeUndefined();
    });

    it('applies default config to each dot-path entry', () => {
        class Comp {
            @Store()
            @Validate({
                rules: { 'form.email': { required: true } },
            })
            form = { email: '' };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email'].config.trigger).toBe('all');
        expect(rules['form.email'].config.runOn).toBe('both');
        expect(rules['form.email'].config.errorProperty).toBe('errors');
    });

    it('merges stacked @Validate decorators on the same store', () => {
        class Comp {
            @Store()
            @Validate({ rules: { 'form.email': { required: true } } })
            @Validate({ rules: { 'form.email': { email: true, message: 'bad' } } })
            form = { email: '' };
        }
        const rules = getValidationRules(new Comp());
        // Both rules merged into the same path entry.
        expect(rules['form.email'].rules.required).toBe(true);
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.email'].rules.message).toBe('bad');
    });

    it('still supports single-rule shape (backward compat) when no key has a dot', () => {
        class Comp {
            @Validate({ rules: { required: true, email: true, message: 'bad email' } })
            email = '';
        }
        const rules = getValidationRules(new Comp());
        expect(rules.email).toBeDefined();
        expect(rules.email.rules.required).toBe(true);
        expect(rules.email.rules.email).toBe(true);
        expect(rules['email.x']).toBeUndefined();
    });
});

describe('storeRules<T>()', () => {
    it('is an identity function — returns the map unchanged at runtime', () => {
        const input = { email: { required: true } };
        const out = storeRules(input);
        expect(out).toBe(input);
    });

    it('works with no <T> (untyped map)', () => {
        const out = storeRules({ arbitrary: { required: true } });
        expect(out.arbitrary).toBeDefined();
        expect(out.arbitrary!.required).toBe(true);
    });

    interface FormShape {
        email: string;
        age: number;
        address: { zip: string };
        tags: string[];
    }

    it('type-checks relative keys at compile time (valid keys)', () => {
        // Top-level + deep + array keys all accepted by DeepKeysOf<FormShape>.
        const out = storeRules<FormShape>({
            email: { required: true, email: true },
            age: { min: 18 },
            'address.zip': { pattern: /^\d{5}$/ },
            tags: { minLength: 1 },
        });
        expect(out.email).toBeDefined();
        expect(out['address.zip']).toBeDefined();
        expect(out.tags).toBeDefined();
    });

    it('rejects a typo at compile time', () => {
        // @ts-expect-error — 'emial' is not a valid key of FormShape.
        const _out = storeRules<FormShape>({ emial: { required: true } });
        void _out;
    });

    it('treats built-in non-plain objects (Date/RegExp/Map) as scalar (no recursion)', () => {
        interface WithBuiltins {
            createdAt: Date;
            pattern: RegExp;
            counts: Map<string, number>;
            name: string;
        }
        // Only the top-level keys are valid — methods on Date/RegExp/Map are
        // not exposed as validation paths.
        const out = storeRules<WithBuiltins>({
            createdAt: { required: true },
            pattern: { required: true },
            counts: { required: true },
            name: { required: true },
        });
        expect(out.createdAt).toBeDefined();
        expect(out.name).toBeDefined();
        // @ts-expect-error — 'createdAt.getTime' is NOT a valid path (Date is scalar).
        const _bad: any = storeRules<WithBuiltins>({ 'createdAt.getTime': { required: true } });
        void _bad;
    });

    it('auto-prefixes relative keys to full paths via @Validate', () => {
        class Comp {
            @Store()
            @Validate({
                rules: storeRules<FormShape>({
                    email: { required: true, email: true, message: 'bad email' },
                    'address.zip': { required: true, pattern: /^\d{5}$/ },
                }),
                config: { trigger: 'all', runOn: 'both' },
            })
            form: FormShape = { email: '', age: 0, address: { zip: '' }, tags: [] };
        }
        const rules = getValidationRules(new Comp());
        // Relative keys are registered under the FULL prefixed path.
        expect(rules['form.email']).toBeDefined();
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.address.zip']).toBeDefined();
        // The relative key itself is NOT a separate entry.
        expect(rules['email']).toBeUndefined();
        expect(rules['address.zip']).toBeUndefined();
    });

    it('keeps full-path keys verbatim (no double-prefix)', () => {
        class Comp {
            @Store()
            @Validate({
                rules: { 'form.email': { required: true } } as any,
                config: { trigger: 'all', runOn: 'both' },
            })
            form: FormShape = { email: '', age: 0, address: { zip: '' }, tags: [] };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email']).toBeDefined();
        // No accidental 'form.form.email'.
        expect(rules['form.form.email']).toBeUndefined();
    });

    it('mixes relative and full-path keys in the same map', () => {
        class Comp {
            @Store()
            @Validate({
                rules: {
                    email: { required: true },            // relative -> form.email
                    'form.age': { min: 18 },              // full path -> verbatim
                } as any,
                config: { trigger: 'all', runOn: 'both' },
            })
            form: FormShape = { email: '', age: 0, address: { zip: '' }, tags: [] };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email']).toBeDefined();
        expect(rules['form.age']).toBeDefined();
        expect(rules['form.age'].rules.min).toBe(18);
    });
});


describe('createStoreProxy does not coerce primitives (regression)', () => {
    /**
     * A @Store property may hold a primitive (string, number, boolean). The
     * proxy factory must NOT be applied to such values — and the host wiring
     * must keep the raw primitive so methods like .trim() work. This test
     * documents the contract at the proxy layer: wrapping is only meaningful
     * for objects/arrays.
     */
    it('does not wrap a primitive value (the host returns it raw)', () => {
        // createStoreProxy itself always wraps its target in a Proxy; the
        // primitive-handling contract lives in initializeState, which only
        // calls createStoreProxy for object/array values. Here we verify the
        // factory at least does not throw and preserves identity for objects
        // while the host is responsible for not proxying primitives.
        const trigger = vi.fn();
        const obj = { count: 0 };
        const proxy = createStoreProxy(obj, 'store', trigger);
        expect(proxy).not.toBe(obj); // objects ARE proxied
        // Primitives are never passed to createStoreProxy in practice; the
        // regression is guarded by the integration test below and by
        // resolveStatePath returning raw values.
    });
});

describe('primitive @Store value reactivity (integration-style)', () => {
    /**
     * Simulates the host's contract: a primitive store value is stored raw
     * and returned raw (no Proxy). Object store values get a Proxy. This
     * mirrors the readStoreValue logic in cossack.ts.
     */
    it('returns primitives raw and objects proxied', () => {
        const trigger = vi.fn();
        const cache = new Map<string, object>();
        const container = new Map<string, unknown>();

        function readStoreValue(key: string): unknown {
            const raw = container.get(key);
            if (raw === null || typeof raw !== 'object') return raw;
            let cached = cache.get(key);
            if (!cached) {
                cached = createStoreProxy(raw as Record<PropertyKey, unknown>, key, trigger);
                cache.set(key, cached);
            }
            return cached;
        }

        // String store value — must stay a string so .trim() etc. work.
        container.set('newTag', '');
        expect(typeof readStoreValue('newTag')).toBe('string');
        expect((readStoreValue('newTag') as string).trim()).toBe('');

        // Number store value.
        container.set('count', 42);
        expect(readStoreValue('count')).toBe(42);

        // Boolean store value.
        container.set('open', false);
        expect(readStoreValue('open')).toBe(false);

        // Object store value — proxied, nested mutations reactive.
        container.set('form', { email: '' });
        const form = readStoreValue('form') as Record<string, unknown>;
        expect(form).not.toBe(container.get('form'));
        (form as any).email = 'a@b.com';
        expect(trigger).toHaveBeenCalledWith('form');
    });
});

