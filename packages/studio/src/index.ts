import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Kysely } from '@cossackframework/database';
import { createLocalConnection } from './lib/local-connection.js';
import { createRemoteD1Connection } from './lib/remote-d1.js';
import { StudioDatabase } from './lib/service.js';
import type { StudioConnection, StudioProvider } from './lib/types.js';
import { serveStudioAsset, toWebRequest, writeWebResponse } from './server/http.js';
import { setStudioDatabase } from './server/runtime.js';
import { createStudioSecurity } from './server/security.js';

export interface StudioRunOptions {
  projectRoot?: string;
  remote?: boolean;
  database?: string;
  env?: string;
  port?: number;
  open?: boolean;
  signal?: AbortSignal;
  connection?: StudioConnection;
  applicationName?: string;
}

async function loadCliClient(projectRoot: string): Promise<Kysely<any>> {
  const configPath = path.resolve(projectRoot, 'src', 'db', 'config.ts');
  let module: any;
  try {
    module = await import(`${pathToFileURL(configPath).href}?studio=${Date.now()}`);
  } catch (error: any) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        'No loadable src/db/config.ts was found. Run `cossack add database` first.',
      );
    }
    throw error;
  }
  if (typeof module.getCliClient !== 'function') {
    throw new Error('src/db/config.ts must export getCliClient().');
  }
  return module.getCliClient();
}

function inferLocalProvider(projectRoot: string): StudioProvider {
  if (process.env.TURSO_URL) return 'libsql';
  if (process.env.DB_PATH) return 'sqlite';
  return path.basename(projectRoot).includes('d1') ? 'd1-local' : 'unknown';
}

async function resolveApplicationName(projectRoot: string): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    );
    return typeof packageJson.displayName === 'string'
      ? packageJson.displayName
      : typeof packageJson.name === 'string'
        ? packageJson.name
        : path.basename(projectRoot);
  } catch {
    return path.basename(projectRoot);
  }
}

function localDatabaseLabel(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.DB_PATH) return path.basename(process.env.DB_PATH);
  if (process.env.TURSO_URL) {
    try {
      return new URL(process.env.TURSO_URL).hostname || 'Turso database';
    } catch {
      return 'Turso database';
    }
  }
  return 'Local database';
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, shell: false, stdio: 'ignore' });
  child.once('error', () => {});
  child.unref();
}

function installNodeDomMetadataShims(): void {
  // Framework declaration output includes legacy decorator metadata for DOM
  // event parameter types. Node never constructs these classes during SSR,
  // but the names must exist while the prebuilt server bundle is evaluated.
  for (const name of [
    'KeyboardEvent',
    'MouseEvent',
    'PointerEvent',
    'InputEvent',
    'SubmitEvent',
    'FocusEvent',
  ]) {
    if (!(name in globalThis)) (globalThis as any)[name] = class extends Event {};
  }
}

export async function runStudio(options: StudioRunOptions = {}): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const port = options.port ?? 4983;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Studio port: ${port}`);
  }
  const connection = options.connection ?? (options.remote
    ? await createRemoteD1Connection({
        projectRoot,
        binding: options.database,
        environment: options.env,
      })
    : createLocalConnection({
        client: await loadCliClient(projectRoot),
        info: {
          provider: inferLocalProvider(projectRoot),
          label: localDatabaseLabel(options.database),
        },
      }));
  const database = new StudioDatabase(connection, {
    applicationName: options.applicationName ?? await resolveApplicationName(projectRoot),
  });
  await database.getSchema();
  setStudioDatabase(database);

  const security = createStudioSecurity(port);
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const clientRoot = path.resolve(packageRoot, 'app', 'client');
  const serverEntry = path.resolve(packageRoot, 'app', 'server', 'entry-server.js');
  let fetchApp: ((request: Request, env?: Record<string, unknown>) => Promise<Response>) | undefined;

  const server = createServer(async (request, response) => {
    security.applyHeaders(response);
    try {
      const authorized = security.authorize(request, response);
      if (authorized !== true) return;
      if (await serveStudioAsset(request, response, clientRoot)) return;
      if (!fetchApp) {
        installNodeDomMetadataShims();
        const module = await import(pathToFileURL(serverEntry).href);
        fetchApp = (incoming, env) => module.app.fetch(incoming, env);
      }
      const webRequest = await toWebRequest(request, security.origin);
      await writeWebResponse(await fetchApp(webRequest, {}), response);
    } catch (error: any) {
      if (!response.headersSent) response.statusCode = 500;
      response.end(error?.message ?? String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const launchUrl = `${security.origin}/?token=${security.launchToken}`;
  console.log(`Cossack Studio: ${launchUrl}`);
  if (connection.info.remote) {
    console.warn('WARNING: Studio is connected to remote D1. Changes affect deployed data immediately.');
  }
  if (options.open !== false) openBrowser(launchUrl);

  await new Promise<void>((resolve) => {
    const shutdown = () => resolve();
    if (options.signal?.aborted) resolve();
    else options.signal?.addEventListener('abort', shutdown, { once: true });
    if (!options.signal) {
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  setStudioDatabase(undefined);
  await database.close();
}

export type {
  StudioConnection,
  StudioConnectionInfo,
  StudioProvider,
} from './lib/types.js';
