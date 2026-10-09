// @vitest-environment node
import { createServer, type ViteDevServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { cossackDevTools } from '../dev/devtools';

it('releases the editor launcher port when Vite closes so another start can bind it', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({ configFile: false, logLevel: 'silent',
      plugins: [cossackDevTools(0)], server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    await expect.poll(() => log.mock.calls.length).toBeGreaterThan(0);
    const first = log.mock.calls.find(([message]) => String(message).startsWith('[DevTools] Server listening'));
    const port = Number(String(first?.[0]).match(/:(\d+)$/)?.[1]);
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    await server.close();
    server = undefined;
    await expect.poll(async () => {
      try { await fetch(`http://127.0.0.1:${port}/`); return false; } catch { return true; }
    }).toBe(true);
    log.mockClear();
    server = await createServer({ configFile: false, logLevel: 'silent',
      plugins: [cossackDevTools(port)], server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    await expect.poll(() => log.mock.calls.length).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  } finally { await server?.close(); log.mockRestore(); }
}, 10_000);
