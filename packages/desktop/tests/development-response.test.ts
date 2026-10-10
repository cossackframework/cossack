import { expect, it, vi } from 'vitest';
import { transformDesktopDocument } from '../src/development-response';

it('transforms documents while preserving status/cookies and removing stale length', async () => {
  const response = new Response('<main>Ready</main>', {
    status: 202,
    headers: {
      'Content-Type': 'text/html',
      'Content-Length': '18',
      'Set-Cookie': 'session=local; HttpOnly',
    },
  });
  const transform = vi.fn(async (pathname: string, html: string) => `${html}<script src="/@vite/client"></script>`);
  const result = await transformDesktopDocument(
    new Request('https://app/example?q=1', { headers: { accept: 'text/html' } }),
    response,
    transform,
  );
  expect(transform).toHaveBeenCalledWith('/example', '<main>Ready</main>');
  expect(result.status).toBe(202);
  expect(result.headers.get('content-length')).toBeNull();
  expect(result.headers.get('set-cookie')).toBe('session=local; HttpOnly');
  expect(await result.text()).toContain('/@vite/client');
});

it.each([
  { method: 'POST', accept: 'text/html', native: false },
  { method: 'GET', accept: 'text/html', native: true },
  { method: 'GET', accept: '*/*', native: false },
])('leaves opaque bodies unread: %j', async ({ method, accept, native }) => {
  const headers = new Headers({ 'Content-Type': 'text/html' });
  if (native) headers.set('X-Cossack-Rpc-Response', 'native');
  const response = new Response('<p>Opaque native output</p>', { headers });
  const transform = vi.fn();
  expect(
    await transformDesktopDocument(
      new Request('https://app/api/result', { method, headers: { accept } }),
      response,
      transform,
    ),
  ).toBe(response);
  expect(response.bodyUsed).toBe(false);
  expect(transform).not.toHaveBeenCalled();
});
