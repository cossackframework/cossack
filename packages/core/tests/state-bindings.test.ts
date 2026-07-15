// tests/state-bindings.test.ts
//
// Verifies the `flash` / `old` auto-bind options on @State and @Store: during
// bootstrap the framework pulls flashed values / old input into state so the
// page needs no `init()` boilerplate to repopulate after a redirect.
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the environment to be server-side BEFORE anything else is imported.
// (Mirrors cossack.server.test.ts; flash readers no-op when isServer is false.)
vi.mock('../src/shared/environment', () => ({
  isServer: true,
}));

import { Cossack } from '../src/shared/cossack';
import { State, Store } from '../src/shared/decorators';
import {
  setFlashStoreGetter,
  __resetFlashForTests,
  type FlashStore,
} from '../src/shared/flash';
import type { Context } from 'hono';

// Mock the renderer (same minimal surface as cossack.server.test.ts).
vi.mock('@cossackframework/renderer', () => {
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        render() { return null; }
        requestUpdate() {}
        mount() {}
        updated() {}
        connectedCallback() {}
        disconnectedCallback() {}
        static properties = {};
        autoBindMethods() {}
        consume() { return undefined; }
        provide() {}
        resetRenderState() {}
    }
    return {
        render: vi.fn(),
        renderToString: vi.fn(() => ''),
        html: (strings: any, ...values: any[]) => ({ strings, values }),
        CossackElement,
        createContext,
        isTemplateResult: vi.fn(() => true),
        pushCurrentInstance: vi.fn(),
        popCurrentInstance: vi.fn(),
        instanceStack: [],
    };
});

/** A minimal Hono-like context for bootstrap. */
function mockContext(): Context {
  return { req: { param: vi.fn() } } as unknown as Context;
}

interface AddressShape {
  street: string;
  city: string;
  state: string;
}

class BindingsComponent extends Cossack<{}> {
  // flash: true → binds flashed('success') by property name.
  @State({ flash: true }) success: string | undefined;
  // flash with explicit key → binds flashed('errMsg').
  @State({ flash: 'errMsg' }) errorAlias: string | undefined;
  // old: true → binds old('name'), falls back to ''.
  @State({ old: true }) name = '';
  // old with explicit dot-path key → binds old('address.street').
  @State({ old: 'address.street' }) street = '';
  // old on a @Store → binds the whole old('address') object at once.
  @Store({ old: true }) address: AddressShape = { street: '', city: '', state: '' };
  // A plain @State with no binding options — unchanged behavior.
  @State() untouched = 'default';
}

describe('auto-bind flash/old into @State / @Store', () => {
  let store: FlashStore;

  beforeEach(() => {
    store = { outgoing: {}, incoming: {} };
    setFlashStoreGetter(() => store);
  });

  afterEach(() => {
    __resetFlashForTests();
  });

  async function bootstrapWith(seed: Record<string, unknown>): Promise<BindingsComponent> {
    // Seed `incoming` flash messages + old input (as if set by the previous
    // POST and carried over via the signed flash cookie).
    store.incoming = { success: 'Saved!', errMsg: 'Something broke', __input: seed };
    const comp = new BindingsComponent();
    await comp.bootstrap({ context: mockContext() });
    return comp;
  }

  it('binds a flashed value by property name (`flash: true`)', async () => {
    const comp = await bootstrapWith({});
    expect(comp.success).toBe('Saved!');
  });

  it('binds a flashed value by an explicit key (`flash: "errMsg"`)', async () => {
    const comp = await bootstrapWith({});
    expect(comp.errorAlias).toBe('Something broke');
  });

  it('binds old input by property name (`old: true`)', async () => {
    const comp = await bootstrapWith({ name: 'Alice' });
    expect(comp.name).toBe('Alice');
  });

  it('binds old input by an explicit dot-path key (`old: "address.street"`)', async () => {
    const comp = await bootstrapWith({ address: { street: '123 Main', city: 'Town', state: 'CA' } });
    expect(comp.street).toBe('123 Main');
  });

  it('binds a whole @Store from old input (`@Store({ old: true })`)', async () => {
    const comp = await bootstrapWith({ address: { street: '123 Main', city: 'Town', state: 'CA' } });
    expect(comp.address).toEqual({ street: '123 Main', city: 'Town', state: 'CA' });
  });

  it('the flashed/old value wins over the class-field initializer', async () => {
    const comp = await bootstrapWith({ name: 'Alice' });
    // Initializer was `name = ''`, but old('name') = 'Alice' wins.
    expect(comp.name).toBe('Alice');
  });

  it('falls back to the initializer when nothing was flashed for that key', async () => {
    // No old input seeded at all.
    const comp = await bootstrapWith({});
    expect(comp.name).toBe('');
    expect(comp.street).toBe('');
    expect(comp.address).toEqual({ street: '', city: '', state: '' });
  });

  it('falls back to the initializer when no flash store is wired', async () => {
    __resetFlashForTests();
    const comp = new BindingsComponent();
    await comp.bootstrap({ context: mockContext() });
    expect(comp.success).toBeUndefined();
    expect(comp.errorAlias).toBeUndefined();
    expect(comp.name).toBe('');
    expect(comp.untouched).toBe('default');
  });

  it('does not affect plain @State without binding options', async () => {
    const comp = await bootstrapWith({ name: 'Alice' });
    expect(comp.untouched).toBe('default');
  });
});
