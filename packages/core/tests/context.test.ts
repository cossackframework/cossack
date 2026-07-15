// tests/context.test.ts
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from 'hono';

// jsdom defines `window`, so `environment.isServer` is false by default and the
// flash module no-ops. getFormData is server-only, so force isServer true for
// the whole file (mirrors flash.test.ts's mock approach).
vi.mock('../src/shared/environment', () => ({
  get isServer() {
    return (globalThis as any).__MOCK_IS_SERVER ?? true;
  },
}));

import { createCossackContext, type CossackContext } from '../src/shared/context';
import {
  setFlashStoreGetter,
  __resetFlashForTests,
  type FlashStore,
} from '../src/shared/flash';

/**
 * Build a minimal Hono-like context whose `req.formData()` returns a real
 * FormData built from [key, value] pairs. This exercises the full
 * `getFormData` -> `parseFormData` -> (optional) `validateObject` pipeline.
 */
function mockContext(pairs: [string, string][]): Context {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return {
    req: { formData: async () => fd },
  } as unknown as Context;
}

describe('createCossackContext — getFormData', () => {
  it('parses nested form data (server side)', async () => {
    const ctx = createCossackContext(
      mockContext([
        ['name', 'Alice'],
        ['address[street]', '123 Main'],
        ['address[city]', 'Anytown'],
      ]),
      true,
    );
    const data = await (ctx as unknown as CossackContext).getFormData();
    expect(data).toEqual({
      name: 'Alice',
      address: { street: '123 Main', city: 'Anytown' },
    });
  });

  it('returns typed data as T (compile-time contract)', async () => {
    interface MyForm {
      name: string;
      address: { street: string; city: string };
    }
    const ctx = createCossackContext(
      mockContext([
        ['name', 'Alice'],
        ['address[street]', '123 Main'],
        ['address[city]', 'Anytown'],
      ]),
      true,
    );
    const data = await (ctx as unknown as CossackContext).getFormData<MyForm>();
    // Runtime check; the <MyForm> is a type-level assertion.
    expect(data.name).toBe('Alice');
    expect(data.address.street).toBe('123 Main');
  });

  it('runs validation when rules are provided and returns {data, errors, valid}', async () => {
    interface MyForm {
      name: string;
      email: string;
    }
    const ctx = createCossackContext(
      mockContext([
        ['name', ''],
        ['email', 'not-an-email'],
      ]),
      true,
    );
    const result = await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: {
        name: { required: true, message: 'Name is required' },
        email: { email: true, message: 'Bad email' },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({
      name: 'Name is required',
      email: 'Bad email',
    });
    // flatErrors mirrors the rule keys (dot-path keyed).
    expect(result.flatErrors).toEqual({
      name: 'Name is required',
      email: 'Bad email',
    });
    // data is still returned (parsed shape), typed as MyForm.
    expect(result.data.name).toBe('');
    expect(result.data.email).toBe('not-an-email');
  });

  it('nests errors by dot-path so errors.address.city works', async () => {
    // Regression for the ObjectValidationResult shape: getFormData({ rules })
    // must return nested errors (option-chaining friendly) AND flatErrors.
    interface NestedForm {
      name: string;
      address: { city: string };
    }
    const ctx = createCossackContext(
      mockContext([['address[city]', '']]),
      true,
    );
    const result = await (ctx as unknown as CossackContext).getFormData<NestedForm>({
      rules: {
        address: { city: { required: true, message: 'City is required' } },
      },
    });
    expect(result.valid).toBe(false);
    // Nested shape: errors.address.city (NOT errors['address.city']).
    expect((result.errors as any).address.city).toBe('City is required');
    // Flat shape: dot-path keyed.
    expect(result.flatErrors['address.city']).toBe('City is required');
  });

  it('returns valid=true when all rules pass', async () => {
    interface MyForm {
      email: string;
    }
    const ctx = createCossackContext(
      mockContext([['email', 'alice@example.com']]),
      true,
    );
    const result = await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { email: { required: true, email: true } },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.data.email).toBe('alice@example.com');
  });

  it('throws on the client (only available on the server)', () => {
    const ctx = createCossackContext(
      { req: { path: '/', param: () => null, query: () => null } } as unknown as Context,
      false, // client side
    );
    expect(() => (ctx as any).getFormData).toThrow(
      /only available on the server/,
    );
  });

  it('still exposes req on both client and server', () => {
    const req = { path: '/x' };
    const serverCtx = createCossackContext({ req } as unknown as Context, true);
    const clientCtx = createCossackContext({ req } as unknown as Context, false);
    expect((serverCtx.req as any).path).toBe('/x');
    expect((clientCtx.req as any).path).toBe('/x');
  });
});

describe('createCossackContext — getFormData auto-flash', () => {
  /** Active flash store for the current test. */
  let store: FlashStore;

  beforeEach(() => {
    store = { outgoing: {}, incoming: {} };
    setFlashStoreGetter(() => store);
  });

  afterEach(() => {
    __resetFlashForTests();
  });

  it('flashes the submitted input by default (no rules)', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', 'Alice']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>();
    // flashInput writes under the reserved __input namespace.
    expect(store.outgoing.__input).toEqual({ name: 'Alice' });
  });

  it('flashes input + errors by default when invalid', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', '']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true, message: 'Name is required' } },
    });
    expect(store.outgoing.__input).toEqual({ name: '' });
    expect(store.outgoing.errors).toEqual({ name: 'Name is required' });
  });

  it('does NOT flash errors on a valid form (avoids empty-error-banner bug)', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', 'Alice']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true } },
    });
    // Input is still flashed (single-use, harmlessly dropped if unread).
    expect(store.outgoing.__input).toEqual({ name: 'Alice' });
    // But no errors key — flashing {} would render truthy-empty error banners.
    expect(store.outgoing.errors).toBeUndefined();
  });

  it('respects flash: false (flashes nothing)', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', '']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true, message: 'Name is required' } },
      flash: false,
    });
    expect(store.outgoing.__input).toBeUndefined();
    expect(store.outgoing.errors).toBeUndefined();
  });

  it('respects flash: { input: false } (errors only)', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', '']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true, message: 'Name is required' } },
      flash: { input: false },
    });
    expect(store.outgoing.__input).toBeUndefined();
    expect(store.outgoing.errors).toEqual({ name: 'Name is required' });
  });

  it('respects flash: { errors: false } (input only)', async () => {
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', '']]), true);
    await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true, message: 'Name is required' } },
      flash: { errors: false },
    });
    expect(store.outgoing.__input).toEqual({ name: '' });
    expect(store.outgoing.errors).toBeUndefined();
  });

  it('no-ops flashing when no flash store is wired (backward compatible)', async () => {
    __resetFlashForTests(); // remove the store getter
    interface MyForm { name: string }
    const ctx = createCossackContext(mockContext([['name', '']]), true);
    // Should not throw, and should still return the validated result.
    const result = await (ctx as unknown as CossackContext).getFormData<MyForm>({
      rules: { name: { required: true, message: 'Name is required' } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ name: 'Name is required' });
  });
});
