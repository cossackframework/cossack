// tests/context.test.ts
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import { createCossackContext, type CossackContext } from '../src/shared/context';

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
    // data is still returned (parsed shape), typed as MyForm.
    expect(result.data.name).toBe('');
    expect(result.data.email).toBe('not-an-email');
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
