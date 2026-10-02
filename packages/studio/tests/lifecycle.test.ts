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
