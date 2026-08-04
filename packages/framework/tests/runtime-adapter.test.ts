import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { assertRuntimeTransportSupport, type CossackRuntimeAdapter } from '../src/runtime-adapter';

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
});
