import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createORM } from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { runStudio } from '../src/index';
import { createLocalConnection } from '../src/lib/local-connection';
import { getStudioDatabase } from '../src/server/runtime';
import type { StudioConnection } from '../src/lib/schema-types';

async function localConnection() {
  return createLocalConnection({
    orm: createORM({ adapter: await nodeSQLite({ filename: ':memory:' }), entities: [] }),
    info: { provider: 'sqlite', label: 'fixture' },
  });
}

async function availablePort() {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No listening address');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

afterEach(() => vi.restoreAllMocks());

describe('Studio readiness and disposal', () => {
  it('reports token-free readiness after listening and closes the server/connection on abort', async () => {
    const connection = await localConnection();
    const close = vi.spyOn(connection, 'close');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const abort = new AbortController();
    const port = await availablePort();
    let resolveReady!: (info: { origin: string; remote: boolean }) => void;
    const ready = new Promise<{ origin: string; remote: boolean }>(resolve => { resolveReady = resolve; });
    const running = runStudio({ port, connection, quiet: true, open: false, signal: abort.signal,
      applicationName: 'Fixture', onReady: resolveReady });
    try {
      const info = await ready;
      expect(info).toEqual({ origin: `http://127.0.0.1:${port}`, remote: false });
      const response = await fetch(info.origin);
      expect(response.status).toBe(401);
      expect(log).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
    } finally {
      abort.abort();
      await running;
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => getStudioDatabase()).toThrow('has not been initialized');
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
  });

  it('answers malformed paths with 400 and hides internal error details', async () => {
    const connection = await localConnection();
    const abort = new AbortController();
    const port = await availablePort();
    let launchUrl = '';
    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      const text = String(message);
      if (text.startsWith('Cossack Studio: ')) launchUrl = text.slice('Cossack Studio: '.length);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const running = runStudio({ port, connection, open: false, signal: abort.signal,
      applicationName: 'Fixture', onReady: () => resolveReady() });
    try {
      await ready;
      const launch = await fetch(launchUrl, { redirect: 'manual' });
      expect(launch.status).toBe(302);
      const cookie = launch.headers.get('set-cookie')!.split(';')[0]!;
      const origin = new URL(launchUrl).origin;

      const malformed = await fetch(`${origin}/%zz`, { headers: { cookie } });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).toBe('Bad Request');

      // Under test the server entry is not built, so loading it fails.
      const failed = await fetch(`${origin}/`, { headers: { cookie } });
      expect(failed.status).toBe(500);
      const body = await failed.text();
      expect(body).toBe('Internal Server Error');
      expect(body).not.toContain('entry-server');
      expect(errors).toHaveBeenCalled();
    } finally {
      abort.abort();
      await running;
    }
  });

  it('closes a connection when schema inspection fails before readiness', async () => {
    const connection: StudioConnection = {
      info: { provider: 'sqlite', label: 'fixture', remote: false },
      execute: vi.fn(async () => { throw new Error('schema unavailable'); }),
      close: vi.fn(async () => {}),
    };
    const onReady = vi.fn();
    await expect(runStudio({ connection, port: await availablePort(), quiet: true, open: false,
      applicationName: 'Fixture', onReady })).rejects.toThrow('schema unavailable');
    expect(onReady).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it('closes a listening server and connection if the readiness callback fails', async () => {
    const connection = await localConnection();
    const close = vi.spyOn(connection, 'close');
    const port = await availablePort();
    await expect(runStudio({ connection, port, quiet: true, open: false, applicationName: 'Fixture',
      onReady: () => { throw new Error('callback failed'); } })).rejects.toThrow('callback failed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => getStudioDatabase()).toThrow('has not been initialized');
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
  });
});
