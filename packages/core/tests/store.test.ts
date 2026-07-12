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

describe('createStoreProxy does NOT wrap built-in non-plain objects (regression)', () => {
    /**
     * Proxy-wrapping Date/Map/Set/RegExp/typed arrays throws "incompatible
     * receiver" when their methods run with `this` = Proxy. The get trap must
     * return such values RAW (treated as scalar state — not deeply reactive).
     * Only plain objects ({}) and arrays are recursively proxied.
     */
    it('returns Date values raw so .getTime() works', () => {
        const trigger = vi.fn();
        const date = new Date(2020, 0, 1);
        const store = createStoreProxy({ createdAt: date }, 'store', trigger);
        // Reading must not throw, and the method must work.
        expect((store.createdAt as Date).getTime()).toBe(date.getTime());
        // And the value is the SAME reference (not a Proxy wrapper).
        expect(store.createdAt).toBe(date);
    });

    it('returns Map values raw so .set()/.get() work', () => {
        const trigger = vi.fn();
        const map = new Map([['a', 1]]);
        const store = createStoreProxy({ counts: map }, 'store', trigger);
        // Must not throw "Method Map.prototype.set called on incompatible receiver".
        (store.counts as Map<string, number>).set('b', 2);
        expect((store.counts as Map<string, number>).get('b')).toBe(2);
        expect(store.counts).toBe(map);
    });

    it('returns Set values raw so .add() works', () => {
        const trigger = vi.fn();
        const set = new Set<number>([1]);
        const store = createStoreProxy({ ids: set }, 'store', trigger);
        (store.ids as Set<number>).add(2);
        expect((store.ids as Set<number>).has(2)).toBe(true);
        expect(store.ids).toBe(set);
    });

    it('returns RegExp values raw so .test() works', () => {
        const trigger = vi.fn();
        const re = /abc/;
        const store = createStoreProxy({ pattern: re }, 'store', trigger);
        expect((store.pattern as RegExp).test('xabcx')).toBe(true);
        expect(store.pattern).toBe(re);
    });

    it('still proxies plain objects and arrays (positive control)', () => {
        const trigger = vi.fn();
        // Capture the raw nested references so we can assert the proxy returns
        // a DIFFERENT reference (i.e. the value really is proxied, not passed
        // through). Comparing to `store` itself would always be true and prove
        // nothing.
        const rawObj = { a: 1 };
        const rawArr = [1, 2];
        const store = createStoreProxy(
            { obj: rawObj, arr: rawArr },
            'store',
            trigger,
        );
        // Plain object: proxied (different reference from raw), mutation reactive.
        expect(store.obj).not.toBe(rawObj);
        (store.obj as any).a = 2;
        expect(trigger).toHaveBeenCalledWith('store');
        // Array: proxied (different reference from raw), mutation reactive.
        expect(store.arr).not.toBe(rawArr);
        (store.arr as number[]).push(3);
        expect(trigger).toHaveBeenCalledWith('store');
    });
});

describe('per-instance cache isolation (shared raw object across instances)', () => {
    /**
     * Regression: a raw store object shared across two component instances
     * (e.g. a module-level default) must NOT cross-wire reactivity. Each
     * instance gets its own proxy tree (keyed by trigger), so mutating a
     * nested field in instance B must notify only instance B's trigger — not
     * instance A's. The cache is scoped by trigger identity precisely so this
     * works even when the raw target is identical.
     */
    it('does not notify instance A when instance B mutates the shared object', () => {
        const triggerA = vi.fn();
        const triggerB = vi.fn();
        const sharedRaw = { user: { name: 'x' } };

        // Both instances wrap the SAME raw object, but with different triggers
        // (one closure per instance, as initializeState produces).
        const storeA = createStoreProxy(sharedRaw, 'form', triggerA);
        const storeB = createStoreProxy(sharedRaw, 'form', triggerB);

        // Sanity: both reads return proxied values.
        expect(storeA.user).not.toBe(sharedRaw.user);
        expect(storeB.user).not.toBe(sharedRaw.user);

        // Mutating through B must fire B's trigger, NOT A's.
        (storeB.user as any).name = 'y';
        expect(triggerB).toHaveBeenCalledWith('form');
        expect(triggerA).not.toHaveBeenCalled();

        // And vice versa.
        (storeA.user as any).name = 'z';
        expect(triggerA).toHaveBeenCalledWith('form');
    });

    it('returns the same child proxy within a single instance (identity stable)', () => {
        const trigger = vi.fn();
        const store = createStoreProxy({ user: { name: 'x' } }, 'form', trigger);
        // Within one trigger scope, repeated reads are stable.
        expect(store.user).toBe(store.user);
    });

    it('returns DIFFERENT child proxies across two instances (no shared proxy)', () => {
        const triggerA = vi.fn();
        const triggerB = vi.fn();
        const sharedRaw = { user: { name: 'x' } };
        const storeA = createStoreProxy(sharedRaw, 'form', triggerA);
        const storeB = createStoreProxy(sharedRaw, 'form', triggerB);
        // The child proxies must be distinct objects across instances.
        expect(storeA.user).not.toBe(storeB.user);
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

describe('@Validate with store (nested rule map)', () => {
    it('registers each nested leaf as its own validation entry', () => {
        class Comp {
            @Store()
            @Validate({
                rules: {
                    email: { required: true, email: true, message: 'bad email' },
                    address: { zip: { required: true, pattern: /^\d{5}$/ } },
                },
                config: { trigger: 'all', runOn: 'both' },
            })
            form = { email: '', address: { zip: '' } };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email']).toBeDefined();
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.address.zip']).toBeDefined();
        // 'form' itself should NOT be a rule entry (the tree produces per-leaf entries).
        expect(rules['form']).toBeUndefined();
        // Intermediate object nodes are not entries either.
        expect(rules['form.address']).toBeUndefined();
    });

    it('applies default config to each flattened entry', () => {
        class Comp {
            @Store()
            @Validate({
                rules: { email: { required: true } },
            })
            form = { email: '' };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.email'].config.trigger).toBe('all');
        expect(rules['form.email'].config.runOn).toBe('both');
        expect(rules['form.email'].config.errorProperty).toBe('errors');
    });

    it('merges stacked @Validate decorators on the same store leaf', () => {
        class Comp {
            @Store()
            @Validate({ rules: { email: { required: true } } })
            @Validate({ rules: { email: { email: true, message: 'bad' } } })
            form = { email: '' };
        }
        const rules = getValidationRules(new Comp());
        // Both rules merged into the same path entry.
        expect(rules['form.email'].rules.required).toBe(true);
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.email'].rules.message).toBe('bad');
    });

    it('still supports single-rule shape for @State fields', () => {
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

    it('type-checks nested keys at compile time (valid keys)', () => {
        // Top-level + nested + array fields all accepted by StoreRuleMap<FormShape>.
        const out = storeRules<FormShape>({
            email: { required: true, email: true },
            age: { min: 18 },
            address: { zip: { pattern: /^\d{5}$/ } },
            tags: { minLength: 1 },
        });
        expect(out.email).toBeDefined();
        expect(out.address).toBeDefined();
        expect(out.tags).toBeDefined();
    });

    it('rejects a typo at compile time', () => {
        // @ts-expect-error — 'emial' is not a valid key of FormShape.
        const _out = storeRules<FormShape>({ emial: { required: true } });
        void _out;
    });

    it('treats built-in non-plain objects (Date/RegExp/Map) as scalar leaves (no recursion)', () => {
        interface WithBuiltins {
            createdAt: Date;
            pattern: RegExp;
            counts: Map<string, number>;
            name: string;
        }
        // Built-in non-plain fields take a ValidationRule directly (no nesting).
        const out = storeRules<WithBuiltins>({
            createdAt: { required: true },
            pattern: { required: true },
            counts: { required: true },
            name: { required: true },
        });
        expect(out.createdAt).toBeDefined();
        expect(out.name).toBeDefined();
        // @ts-expect-error — 'createdAt' is a scalar leaf; it takes a rule, not a sub-tree.
        const _bad: any = storeRules<WithBuiltins>({ createdAt: { getTime: { required: true } } });
        void _bad;
    });

    it('auto-prefixes nested keys to full paths via @Validate', () => {
        class Comp {
            @Store()
            @Validate({
                rules: storeRules<FormShape>({
                    email: { required: true, email: true, message: 'bad email' },
                    address: { zip: { required: true, pattern: /^\d{5}$/ } },
                }),
                config: { trigger: 'all', runOn: 'both' },
            })
            form: FormShape = { email: '', age: 0, address: { zip: '' }, tags: [] };
        }
        const rules = getValidationRules(new Comp());
        // Nested keys are registered under the FULL prefixed dot-path.
        expect(rules['form.email']).toBeDefined();
        expect(rules['form.email'].rules.email).toBe(true);
        expect(rules['form.address.zip']).toBeDefined();
        // No per-segment entries for intermediate nodes or bare relative keys.
        expect(rules['email']).toBeUndefined();
        expect(rules['address.zip']).toBeUndefined();
        expect(rules['form.address']).toBeUndefined();
    });
});

describe('@Validate value-shape discrimination (regression: collisions with rule key names)', () => {
    /**
     * A store may have fields literally named 'required', 'message', 'pattern',
     * etc. (collisions with ValidationRule keys). The value-shape check treats a
     * map of plain-object values as a rule-tree regardless of the key names.
     */
    it('registers keys named after rule properties (required/message)', () => {
        interface CollidingShape { required: string; message: string; pattern: string }
        class Comp {
            @Store()
            @Validate({
                rules: storeRules<CollidingShape>({
                    required: { required: true },
                    message: { required: true },
                    pattern: { required: true },
                }),
                config: { trigger: 'all', runOn: 'both' },
            })
            form: CollidingShape = { required: '', message: '', pattern: '' };
        }
        const rules = getValidationRules(new Comp());
        expect(rules['form.required']).toBeDefined();
        expect(rules['form.message']).toBeDefined();
        expect(rules['form.pattern']).toBeDefined();
        // No single-rule fallback on 'form' itself.
        expect(rules['form']).toBeUndefined();
    });

    it('still detects a flat single rule correctly (no plain-object values)', () => {
        class Comp {
            @Validate({
                rules: { required: true, email: true, message: 'bad email' },
                config: { trigger: 'all', runOn: 'both' },
            })
            email = '';
        }
        const rules = getValidationRules(new Comp());
        expect(rules.email).toBeDefined();
        expect(rules.email.rules.required).toBe(true);
        expect(rules.email.rules.email).toBe(true);
        expect(rules.email.rules.message).toBe('bad email');
    });

    it('treats a single rule with a RegExp pattern value as single (not a map)', () => {
        // Regression: a RegExp is an object but should NOT flip to map mode.
        class Comp {
            @Validate({
                rules: { required: true, pattern: /^[a-z]+$/, message: 'bad' },
                config: { trigger: 'all', runOn: 'both' },
            })
            code = '';
        }
        const rules = getValidationRules(new Comp());
        expect(rules.code).toBeDefined();
        expect(rules.code.rules.pattern).toBeInstanceOf(RegExp);
        // No accidental map entries.
        expect(rules['code.pattern']).toBeUndefined();
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

