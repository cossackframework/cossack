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

beforeEach(() => {
  vi.resetModules();
  mocks.state.desktopOptions = undefined;
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
