/**
 * Programmatic entry for scaffolding a new Cossack project.
 *
 * Used both by the `create-cossack-app` bin and by `cossack create`, so both
 * paths produce identical projects (single source of truth) and both write a
 * `.cossack/scaffold.json` manifest for later drift detection by
 * `cossack upgrade`.
 */
import fs from 'fs/promises';
import { createHash } from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Pinned `better-sqlite3` version — used in the template's devDependencies
 * (for Cloudflare projects' local migration dev) and moved to runtime
 * dependencies for Node.js projects. Single source of truth so both
 * versions stay in sync.
 */
const BETTER_SQLITE3_VERSION = '^11.0.0';

/**
 * @param {string} projectName
 * @param {{ adapter?: 'cloudflare' | 'node' }} [options]
 * @returns {Promise<{ projectDir: string, adapter: string, manifestPath: string }>}
 */
export async function createApp(projectName, options = {}) {
  if (!projectName) {
    throw new Error('Please provide a project name. Usage: create-cossack-app <project-name>');
  }

  const projectDir = path.resolve(process.cwd(), projectName);
  const templateDir = path.resolve(__dirname, 'template');

  let adapter = options.adapter;
  if (!adapter) {
    const response = await prompts({
      type: 'select',
      name: 'adapter',
      message: 'Which adapter would you like to use?',
      choices: [
        { title: 'Cloudflare Workers (Default)', value: 'cloudflare' },
        { title: 'Node.js', value: 'node' },
      ],
    });
    adapter = response.adapter || 'cloudflare';
  }

  await fs.mkdir(projectDir, { recursive: true });
  await fs.cp(templateDir, projectDir, { recursive: true });

  // Write tsconfig.json (kept outside template/ to avoid IDE errors in the monorepo)
  const tsconfigSource = path.resolve(__dirname, 'tsconfig.template.json');
  await fs.copyFile(tsconfigSource, path.join(projectDir, 'tsconfig.json'));

  // Update compatibility_date to today
  const wranglerPath = path.join(projectDir, 'wrangler.jsonc');
  if ((await safeAccess(wranglerPath))) {
    let wranglerContent = await fs.readFile(wranglerPath, 'utf-8');
    const today = new Date().toISOString().split('T')[0];
    wranglerContent = wranglerContent.replace(
      /"compatibility_date"\s*:\s*"\d{4}-\d{2}-\d{2}"/,
      `"compatibility_date": "${today}"`,
    );
    await fs.writeFile(wranglerPath, wranglerContent);
  }

  if (adapter === 'node') {
    await configureNodeAdapter(projectDir);
  }

  // Write the scaffold manifest used by `cossack upgrade` for drift detection.
  const manifestPath = await writeScaffoldManifest(projectDir, adapter);

  return { projectDir, adapter, manifestPath };
}

async function configureNodeAdapter(projectDir) {
  console.log('Configuring for Node.js...');

  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

  delete packageJson.devDependencies['wrangler'];
  delete packageJson.devDependencies['@cloudflare/workers-types'];
  delete packageJson.devDependencies['@cloudflare/vite-plugin'];

  // Source the @cossackframework/node-adapter version from create-cossack-app's
  // own package version (they release in lockstep) so it tracks the framework
  // instead of rotting at a hardcoded stale value. Third-party deps are aligned
  // with the node-adapter's own declared ranges.
  const ccaVersion = JSON.parse(await fs.readFile(path.resolve(__dirname, 'package.json'), 'utf-8')).version;
  packageJson.dependencies['@cossackframework/node-adapter'] = `^${ccaVersion}`;
  packageJson.dependencies['@hono/node-server'] = '^1.13.0';
  packageJson.dependencies['ws'] = '^8.18.0';

  // better-sqlite3 is a runtime dependency for Node.js (used by the database
  // config as the default SQLite connection — D1 doesn't exist outside Workers).
  // Cloudflare projects install it optionally (for local migration dev only);
  // Node.js projects need it at runtime.
  packageJson.dependencies['better-sqlite3'] = BETTER_SQLITE3_VERSION;

  packageJson.devDependencies['@types/ws'] = '^8.18.0';
  packageJson.devDependencies['@types/node'] = '^22.0.0';

  packageJson.scripts['dev'] = 'node scripts/dev.js';
  packageJson.scripts['start'] = 'node dist/server/index.js';

  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

  await fs.rm(path.join(projectDir, 'wrangler.jsonc'), { force: true });

  // The Cloudflare-specific worker-configuration.d.ts (D1Database, Fetcher, etc.)
  // isn't applicable to Node.js. The tsconfig below switches to `node` types.
  await fs.rm(path.join(projectDir, 'worker-configuration.d.ts'), { force: true });

  const tsconfigPath = path.join(projectDir, 'tsconfig.json');
  const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, 'utf-8'));
  tsconfig.compilerOptions.types = ['vite/client', 'node'];
  await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

  // Rewrite src/db/config.ts for Node.js — use better-sqlite3 as the default
  // connection (D1 bindings only exist inside Cloudflare Workers).
  const dbConfigContent = `import {
  Kysely,
  SqliteDialect,
  type DbClient,
} from '@cossackframework/database';
import Database from 'better-sqlite3';

/**
 * Build a per-request Kysely client from a local SQLite database.
 * Used by src/middlewares/db.ts which is registered in src/bootstrap/middlewares.ts.
 *
 * On Node.js, the default is a local SQLite file (better-sqlite3). Set
 * DB_PATH to point at a custom path. Defaults to ./database.sqlite.
 */
export function createClient(env: { DB_PATH?: string } = {}): DbClient {
  const localPath = env.DB_PATH ?? process.env.DB_PATH ?? './database.sqlite';
  return new Kysely({
    dialect: new SqliteDialect({ database: new Database(localPath) }),
  }) as DbClient;
}

/**
 * Build a Kysely client for the CLI (migrations & seeders). Reads the same
 * DB_PATH env var (defaults to ./database.sqlite).
 */
export async function getCliClient(): Promise<DbClient> {
  return createClient();
}
`;
  await fs.writeFile(path.join(projectDir, 'src/db/config.ts'), dbConfigContent);

  const indexTsContent = `import { serve } from '@hono/node-server';
import { CossackNodeAdapter, createNodeEmailSender } from '@cossackframework/node-adapter';
import { createApp } from '@cossackframework/framework/router';

const app = createApp();

// Runtime bindings — mirrors Cloudflare's \`env\` so application code stays
// identical across runtimes. The database client uses a local SQLite file
// (better-sqlite3); set DB_PATH to customize. The email sender polyfills the
// \`send_email\` binding via SMTP (configure SMTP_* env vars when you add auth/email).
const env: Record<string, unknown> = {
    DB_PATH: process.env.DB_PATH ?? './database.sqlite',
};
if (process.env.SMTP_HOST) {
    env.EMAIL = createNodeEmailSender({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
        from: process.env.MAIL_FROM ?? 'no-reply@example.com',
    });
}

const server = serve({
    // Pass env so \`c.env\` / \`this.env\` is populated for @Server methods.
    fetch: (req) => app.fetch(req, env),
    port: Number(process.env.PORT) || 3000,
}, (info) => {
    console.log(\`Listening on http://localhost:\${info.port}\`);
});

// Pass env to the WebSocket adapter too, so @Server methods over WS see the
// same bindings (this.env.EMAIL, etc.) as over HTTP.
// new CossackNodeAdapter({ server, componentRegistry, env });
`;
  await fs.writeFile(path.join(projectDir, 'src/index.ts'), indexTsContent);

  // Update vite.config.ts for Node.js output. Remove the Cloudflare-specific
  // blocks via their structural markers rather than pattern-matching the exact
  // import/call syntax (which broke if formatting drifted).
  const viteConfigPath = path.join(projectDir, 'vite.config.ts');
  let viteConfig = await fs.readFile(viteConfigPath, 'utf-8');
  viteConfig = viteConfig.replace(
    /\/\/ @cossack:cloudflare-start[\s\S]*?\/\/ @cossack:cloudflare-end\n?/g,
    '',
  );
  await fs.writeFile(viteConfigPath, viteConfig);
}

async function safeAccess(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeScaffoldManifest(projectDir, adapter) {
  const version = await readOwnVersion();
  const files = {};
  await walk(projectDir, '', async (abs, rel) => {
    // skip the manifest itself and version-control dirs
    if (rel === '.cossack/scaffold.json') return;
    if (rel.startsWith('.git/') || rel === '.git') return;
    if (rel === 'node_modules' || rel.startsWith('node_modules/')) return;
    const buf = await fs.readFile(abs);
    files[rel] = createHash('sha256').update(buf).digest('hex');
  });
  const manifest = {
    schemaVersion: 1,
    tool: 'create-cossack-app',
    templateVersion: version,
    createdAt: new Date().toISOString(),
    adapter,
    files,
  };
  const manifestDir = path.join(projectDir, '.cossack');
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'scaffold.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifestPath;
}

async function readOwnVersion() {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.resolve(__dirname, 'package.json'), 'utf-8'),
    );
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function walk(root, prefix, visit) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(abs, rel, visit);
    } else if (entry.isFile()) {
      await visit(abs, rel);
    }
  }
}
