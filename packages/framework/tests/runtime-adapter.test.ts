import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { assertRuntimeTransportSupport, type CossackRuntimeAdapter } from '../src/runtime-adapter';
import { createApp } from '../src/router';

describe('runtime adapter contract', () => {
  const deno = { name: 'deno' } satisfies CossackRuntimeAdapter;

  it('accepts process-local WebSockets and rejects durable state', () => {
    expect(() => assertRuntimeTransportSupport(deno, {
      transport: 'durable-object', stateful: false,
    })).not.toThrow();
    expect(() => assertRuntimeTransportSupport(deno, {
      transport: 'durable-object', stateful: true,
    })).toThrow('process-local');
  });

  it('does not alter Cloudflare behavior without an adapter', () => {
    expect(() => assertRuntimeTransportSupport(undefined, {
      transport: 'durable-object', stateful: true,
    })).not.toThrow();
  });

  it('hydrates the adapter runtime identity for shared components', async () => {
    const app = createApp({
      runtimeAdapter: {
        name: 'deno',
        getClientMetadata: () => ({ platform: 'desktop', capability: 'test-token' }),
      },
    });

    const response = await app.request('/this-page-does-not-exist');
    const html = await response.text();

    expect(html).toContain('"runtime":{"platform":"desktop","capability":"test-token","adapter":"deno"}');
  });
});
