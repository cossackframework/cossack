import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    entry: undefined as unknown,
    desktopOptions: undefined as undefined | {
      env?: Record<string, unknown>;
      fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
    },
  };
  const server = {
    config: {
      mode: 'desktop',
      envDir: '/project',
      root: '/project',
      configFile: '/project/vite.config.ts',
      publicDir: '',
      logger: { error: vi.fn() },
    },
    environments: {
      ssr: {
        runner: { import: vi.fn(async () => state.entry), clearCache: vi.fn() },
        moduleGraph: { invalidateAll: vi.fn(), getModulesByFile: vi.fn() },
      },
    },
    watcher: { on() { return this; } },
    middlewares: vi.fn(),
    ws: { send: vi.fn() },
    transformIndexHtml: vi.fn(async (_pathname: string, html: string) => html),
    close: vi.fn(async () => {}),
  };
  return {
    state,
    server,
    vite: {
      createServer: vi.fn(async () => server),
      isRunnableDevEnvironment: vi.fn(() => true),
      loadEnv: vi.fn(() => ({ DOTENV_SECRET: 'from-dotenv' })),
    },
    desktop: {
      app: { exit: vi.fn(), on: vi.fn() },
      BrowserWindow: { getAllWindows: vi.fn(() => []) },
      createDesktopApp: vi.fn(async (options: NonNullable<typeof state.desktopOptions>) => {
        state.desktopOptions = options;
        return {};
      }),
    },
    http: {
      createServer: vi.fn(() => ({
        once: vi.fn(),
        listen: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
        address: () => ({ port: 4567 }),
        closeAllConnections: vi.fn(),
        close: vi.fn((done: () => void) => done()),
      })),
    },
  };
});

vi.mock('vite', () => mocks.vite);
vi.mock('../src/index.js', () => mocks.desktop);
vi.mock('node:http', () => mocks.http);

const reserved = { ASSETS: { fetch: () => new Response() }, COSSACK_DESKTOP: { shell: true } };

// The loopback Vite asset server. By default it has no file for a request.
const viteServer = vi.fn(async (_url: string, _init?: RequestInit) => new Response('Not found', { status: 404 }));

beforeEach(() => {
  vi.resetModules();
  mocks.state.desktopOptions = undefined;
  mocks.server.config.publicDir = '';
  viteServer.mockClear();
  vi.stubGlobal('fetch', viteServer);
  process.env.SOME_HOST_SECRET = 'host-secret';
  const once = process.once.bind(process);
  // The runtime installs signal supervisors; keep them off the test worker.
  vi.spyOn(process, 'once').mockImplementation(((event: string, listener: (...args: any[]) => void) =>
    ['SIGINT', 'SIGTERM', 'disconnect'].includes(event) ? process : once(event, listener)) as typeof process.once);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.SOME_HOST_SECRET;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function startWith(entry: Record<string, unknown>) {
  const fetch = vi.fn(async (_request: Request, _env?: Record<string, unknown>) => new Response('ok'));
  mocks.state.entry = {
    frameworkApp: { fetch },
    startDesktop: async (factory: (options: Record<string, unknown>) => Promise<unknown>) => factory({
      identifier: 'dev.cossack.env',
      productName: 'Env',
      assetsRoot: '/project/dist/client',
      env: { FROM_OPTIONS: 'options' },
      fetch: () => new Response('unused'),
    }),
    ...entry,
  };
  await import('../src/development-runtime');
  await vi.waitFor(() => expect(mocks.state.desktopOptions).toBeDefined());
  const options = mocks.state.desktopOptions!;
  // createDesktopApp passes the app's options.env plus its reserved bindings.
  await options.fetch(new Request('https://app/'), { ...options.env, ...reserved });
  expect(fetch).toHaveBeenCalledOnce();
  return fetch.mock.calls[0][1]!;
}

it('passes only the app-declared env, never every host or dotenv variable', async () => {
  const env = await startWith({ env: { DECLARED: 'entry' } });
  expect(env).toEqual({ FROM_OPTIONS: 'options', DECLARED: 'entry', ...reserved });
  expect(env).not.toHaveProperty('SOME_HOST_SECRET');
  expect(env).not.toHaveProperty('DOTENV_SECRET');
});

it('lets createEnv(variables) choose bindings from host and dotenv variables, like Node development', async () => {
  const createEnv = vi.fn((variables: Record<string, string | undefined>) => ({ API_KEY: variables.DOTENV_SECRET }));
  const env = await startWith({ createEnv });
  expect(createEnv).toHaveBeenCalledWith(expect.objectContaining({
    DOTENV_SECRET: 'from-dotenv',
    SOME_HOST_SECRET: 'host-secret',
  }));
  expect(env).toEqual({ FROM_OPTIONS: 'options', API_KEY: 'from-dotenv', ...reserved });
});

it('sends public files through the application and answers other requests from Vite first', async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), 'cossack-desktop-public-'));
  try {
    await mkdir(path.join(publicDir, 'vault'));
    await writeFile(path.join(publicDir, 'vault/record.txt'), 'vault record');
    mocks.server.config.publicDir = publicDir;
    viteServer.mockImplementation(async (url: string) => new URL(url).pathname === '/@vite/client'
      ? new Response('vite client', { headers: { 'content-type': 'text/javascript' } })
      : new Response('Not found', { status: 404 }));
    await startWith({});
    const options = mocks.state.desktopOptions!;
    const application = mocks.state.entry as { frameworkApp: { fetch: ReturnType<typeof vi.fn> } };
    const dispatch = (url: string) => options.fetch(new Request(url, { headers: { accept: 'text/html' } }), { ...reserved });
    application.frameworkApp.fetch.mockClear();
    mocks.server.transformIndexHtml.mockClear();
    viteServer.mockClear();

    // A public file reaches the application and its policies without Vite answering first.
    application.frameworkApp.fetch.mockResolvedValueOnce(new Response('<p>public</p>', { headers: { 'content-type': 'text/html' } }));
    expect(await (await dispatch('https://app/vault/record.txt')).text()).toBe('<p>public</p>');
    expect(viteServer).not.toHaveBeenCalled();
    expect(application.frameworkApp.fetch).toHaveBeenCalledOnce();
    // Its bytes are not rewritten as an SSR document.
    expect(mocks.server.transformIndexHtml).not.toHaveBeenCalled();

    // Vite answers its client and modules before the application.
    expect(await (await dispatch('https://app/@vite/client')).text()).toBe('vite client');
    expect(viteServer).toHaveBeenLastCalledWith('http://127.0.0.1:4567/@vite/client', expect.anything());
    expect(application.frameworkApp.fetch).toHaveBeenCalledOnce();

    // Module imports of public files, and anything Vite does not have, reach Vite first.
    await dispatch('https://app/vault/record.txt?import');
    expect(viteServer).toHaveBeenLastCalledWith('http://127.0.0.1:4567/vault/record.txt?import', expect.anything());
    application.frameworkApp.fetch.mockResolvedValueOnce(new Response('<p>missing</p>', { headers: { 'content-type': 'text/html' } }));
    await dispatch('https://app/vault/missing.txt');
    expect(viteServer).toHaveBeenLastCalledWith('http://127.0.0.1:4567/vault/missing.txt', expect.anything());
    expect(application.frameworkApp.fetch).toHaveBeenCalledTimes(3);
    // Application documents still receive the Vite client.
    expect(mocks.server.transformIndexHtml).toHaveBeenCalledOnce();
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

it('discards a stale startup error without reloading the first window', async () => {
  mocks.server.config.logger.error.mockClear();
  mocks.server.ws.send.mockClear();
  mocks.state.entry = {
    frameworkApp: { fetch: vi.fn(async () => new Response('ok')) },
    startDesktop: async (factory: (options: Record<string, unknown>) => Promise<unknown>) => factory({
      identifier: 'dev.cossack.recovery',
      productName: 'Recovery',
      assetsRoot: '/project/dist/client',
      fetch: () => new Response('unused'),
    }),
  };
  mocks.server.environments.ssr.runner.import.mockRejectedValueOnce(new Error('[PARSE_ERROR] broken page'));
  await import('../src/development-runtime');
  await vi.waitFor(() => expect(mocks.server.config.logger.error).toHaveBeenCalledWith(expect.stringContaining('broken page')));
  expect(mocks.state.desktopOptions).toBeUndefined();

  // Repaired source boots the application.
  const { plugins } = mocks.vite.createServer.mock.calls.at(-1)![0] as unknown as {
    plugins: Array<{ hotUpdate(this: unknown, update: { file: string }): unknown }>;
  };
  plugins[0].hotUpdate.call({ environment: { name: 'ssr' } }, { file: '/project/src/pages/index.ts' });
  await vi.waitFor(() => expect(mocks.state.desktopOptions).toBeDefined());

  // The startup error that Vite keeps for the first browser is replaced before
  // the first window opens. Vite clients reload for an HTML path only when they
  // show that page, and no Desktop page is served under /@cossack-desktop/.
  expect(mocks.server.ws.send).toHaveBeenCalledOnce();
  expect(mocks.server.ws.send).toHaveBeenCalledWith({
    type: 'full-reload',
    path: expect.stringMatching(/^\/@cossack-desktop\/[^/]+\.html$/),
  });
  expect(mocks.server.ws.send.mock.invocationCallOrder[0])
    .toBeLessThan(mocks.desktop.createDesktopApp.mock.invocationCallOrder.at(-1)!);
});
