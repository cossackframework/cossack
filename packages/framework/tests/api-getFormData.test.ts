// tests/api-getFormData.test.ts
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { Cossack, Page, storeRules } from '@cossackframework/core';
import { createApiHandler } from '../src/api-handler';

/**
 * Regression test: `this.c.getFormData<T>()` must work from an API handler.
 *
 * The API-handler path assigns the context itself (it does NOT go through the
 * page-render bootstrap), so it must wrap the raw Hono context with
 * `createCossackContext` — otherwise `getFormData` is undefined at runtime
 * (TypeError: this.c.getFormData is not a function), while the type system
 * still believes it exists. This test exercises the real dispatch path.
 */
interface MyForm {
  name: string;
  email: string;
}

@Page({ transport: 'http' })
class FormDataApi extends Cossack {
  async post() {
    const { data, errors, valid } = await this.c.getFormData<MyForm>({
      rules: storeRules<MyForm>({
        name: { required: true, message: 'Name is required' },
        email: { email: true, message: 'Bad email' },
      }),
    });
    return this.c.json({ data, errors, valid }, valid ? 200 : 400);
  }
}

describe('createApiHandler — getFormData<T>()', () => {
  const app = new Hono();
  app.post('/form', createApiHandler(FormDataApi, 'post'));

  it('parses and validates nested form data through the API handler path', async () => {
    const form = new FormData();
    form.append('name', 'Alice');
    form.append('email', 'alice@example.com');

    const res = await app.request('/form', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual({});
    expect(body.data).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('returns validation errors when rules fail', async () => {
    const form = new FormData();
    form.append('name', '');
    form.append('email', 'not-an-email');

    const res = await app.request('/form', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual({
      name: 'Name is required',
      email: 'Bad email',
    });
  });
});
