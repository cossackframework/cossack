import { beforeAll, describe, expect, it } from 'vitest';
import type { DenoApplication } from '../src/index';

let createDenoAdapter: typeof import('../src/index').createDenoAdapter;

beforeAll(async () => {
  class NotFound extends Error {}
  (globalThis as any).Deno = {
    errors: { NotFound },
    lstatSync: () => { throw new NotFound(); },
    open: async () => { throw new NotFound(); },
  };
  ({ createDenoAdapter } = await import('../src/index'));
  delete (globalThis as any).Deno;
});

describe('Deno adapter fetch handler', () => {
  it('merges configured and request env and injects an ASSETS binding', async () => {
    const adapter = createDenoAdapter({ env: { SHARED: 'configured', CONFIGURED: true } });
    const app: DenoApplication = {
      async fetch(_request, env = {}) {
        const assets = env.ASSETS as { fetch(request: Request): Promise<Response> };
        const missing = await assets.fetch(new Request('http://localhost/not-an-asset'));
        return Response.json({
          shared: env.SHARED,
          configured: env.CONFIGURED,
          requestOnly: env.REQUEST_ONLY,
          assetStatus: missing.status,
        });
      },
    };

    const response = await adapter.fetch(app, new Request('http://localhost/data'), {
      SHARED: 'request',
      REQUEST_ONLY: 42,
    });

    expect(await response.json()).toEqual({
      shared: 'request',
      configured: true,
      requestOnly: 42,
      assetStatus: 404,
    });
  });

  it('requires Deno 2.9+ to start a local server', () => {
    expect(() => createDenoAdapter().serve({ fetch: () => new Response() }))
      .toThrow('requires Deno 2.9 or newer');
  });
});
