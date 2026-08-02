import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ORM, ORMConfig } from '@cossackframework/database';
import { createLocalConnection } from './lib/local-connection.js';
import {
  databaseLabelFromEnvironment,
  detectStudioProvider,
  normalizeStudioProvider,
} from './lib/provider.js';
import { createRemoteD1Connection } from './lib/remote-d1.js';
import { StudioDatabase } from './lib/service.js';
import type { StudioConnection, StudioProvider } from './lib/schema-types.js';
import { serveStudioAsset, toWebRequest, writeWebResponse } from './server/http.js';
import { setStudioDatabase } from './server/runtime.js';
import { createStudioSecurity } from './server/security.js';

interface EnvFileProcess {
  loadEnvFile(path: string): void;
}

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
  provider?: StudioProvider;
}

async function loadProjectORM(projectRoot: string): Promise<ORM> {
  const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
  let packageJsonPath: string;
  try {
    packageJsonPath = requireFromProject.resolve('@cossackframework/database/package.json');
  } catch {
    throw new Error(
      '@cossackframework/database is not installed in this application. ' +
      'Run `cossack add database` or install dependencies.',
    );
  }
  const toolingPath = path.join(
    path.dirname(packageJsonPath),
    'dist',
    'tooling',
    'index.js',
  );
  const tooling = await import(pathToFileURL(toolingPath).href) as {
    loadORMConfig?: (path: string) => Promise<ORMConfig>;
    createORMFromConfig?: (config: ORMConfig) => Promise<ORM>;
  };
  if (!tooling.loadORMConfig || !tooling.createORMFromConfig) {
    throw new Error(
      'Studio requires @cossackframework/database 1.0.0 or newer with tooling exports.',
    );
  }
  const config = await tooling.loadORMConfig(path.join(projectRoot, 'orm.config.ts'));
  return tooling.createORMFromConfig(config);
}

async function loadProjectEnvironment(projectRoot: string): Promise<void> {
  let runtime: string | undefined;
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    );
    runtime = packageJson.cossack?.runtime;
  } catch {}
  const filenames = runtime === 'cloudflare'
    ? ['.dev.vars', '.env']
    : ['.env', '.dev.vars'];
  for (const filename of filenames) {
    const envPath = path.join(projectRoot, filename);
    try {
      await fs.access(envPath);
      (process as typeof process & EnvFileProcess).loadEnvFile(envPath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
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

function localDatabaseLabel(provider: StudioProvider, explicit?: string): string {
  if (explicit) return explicit;
  const detected = databaseLabelFromEnvironment(provider);
  if (detected) return detected;
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

async function createProjectConnection(
  projectRoot: string,
  options: StudioRunOptions,
): Promise<StudioConnection> {
  await loadProjectEnvironment(projectRoot);
  const orm = await loadProjectORM(projectRoot);
  const provider = options.provider
    ? normalizeStudioProvider(options.provider)
    : await detectStudioProvider(orm);
  if (!provider || provider === 'unknown' || provider === 'd1-remote') {
    await orm.close().catch(() => {});
    throw new Error(
      'Studio could not detect the ORM database driver. ' +
      'Set DB_CONNECTION (or COSSACK_STUDIO_DRIVER) to sqlite, turso, d1, postgres, or mysql.',
    );
  }
  return createLocalConnection({
    orm,
    info: {
      provider,
      label: localDatabaseLabel(provider, options.database),
    },
  });
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
    : await createProjectConnection(projectRoot, options));
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
  StudioColumn,
  StudioConnection,
  StudioConnectionInfo,
  StudioForeignKey,
  StudioForeignKeyColumn,
  StudioIndex,
  StudioIndexColumn,
  StudioObject,
  StudioPragma,
  StudioPragmaOption,
  StudioProvider,
  StudioQueryResult,
  StudioRowLocator,
  StudioSchema,
} from './lib/schema-types.js';
export type {
  BrowseFilter,
  BrowseFilterOperator,
  BrowseOptions,
  BrowseSort,
  InsertCell,
  InsertValueKind,
  MutationResult,
  TransportQueryResult,
  TransportValue,
} from './lib/query-types.js';
export {
  detectStudioProvider,
  normalizeStudioProvider,
} from './lib/provider.js';
