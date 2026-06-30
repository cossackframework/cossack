/**
 * Stub content generators for `cossack generate` and `cossack add`.
 * Kept as pure functions (string in, string out) so they are trivially testable.
 *
 * Conventions mirror the framework's own source:
 *   pages    : @Page() class extends Cossack, default export
 *   layouts  : @Page({ transport: 'http' }) class extends Cossack, default export
 *   components: @Component() class extends Cossack, named export
 *   services : @Service() class (no extends)
 *   middleware: defineServerMiddleware, named camelCase export
 */

export function pageTemplate({ className, title }) {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class ${className} extends Cossack {
  render() {
    return html\`
      <div class="p-8">
        <h1 class="text-2xl font-bold">${title}</h1>
      </div>
    \`;
  }
}
`;
}

export function pageMdxTemplate({ title }) {
  return `---
title: ${title}
---

# ${title}

Edit this page at \`src/pages/<name>/index.mdx\`.
`;
}

export function componentTemplate({ className, propsName }) {
  return `import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';

interface ${propsName} {
  [key: string]: any;
}

@Component()
export class ${className} extends Cossack {
  declare props: ${propsName};

  render() {
    return html\`
      <div>
        \${this.children}
      </div>
    \`;
  }
}
`;
}

export function layoutTemplate({ className, kebab }) {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ${className} extends Cossack {
  render() {
    return html\`
      <div class="${kebab}-layout">
        \${this.children}
      </div>
    \`;
  }
}
`;
}

export function middlewareTemplate({ exportName }) {
  return `import { defineServerMiddleware } from '@cossackframework/core';

export const ${exportName} = defineServerMiddleware(async (c, next) => {
  // TODO: implement your middleware here.
  await next();
});
`;
}

export function serviceTemplate({ className }) {
  return `import { Service, State, Server } from '@cossackframework/core';

@Service()
export class ${className} {
  @State() count = 0;

  @Server()
  increment() {
    this.count++;
  }
}
`;
}

// --- auth feature stubs -----------------------------------------------------

export function authLayoutTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
  render() {
    return html\`
      <div class="auth-layout flex justify-center items-center min-h-[80vh] bg-gray-100">
        <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-[400px]">
          <h2 class="text-center text-gray-800 mb-6">Cossack Auth</h2>
          \${this.children}
          <div class="mt-6 text-center text-sm">
            <a href="/" class="text-gray-500">&larr; Back to Home</a>
          </div>
        </div>
      </div>
    \`;
  }
}
`;
}

export function loginPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Login</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" placeholder="user@example.com" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" name="password" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Sign In
        </button>
      </form>
      <p class="mt-4 text-center">
        Don't have an account? <a href="/register" class="text-blue-600">Register</a>
      </p>
    \`;
  }
}
`;
}

export function registerPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Register</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Name</label>
          <input type="text" name="name" class="w-full p-2 border rounded" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" name="password" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Create Account
        </button>
      </form>
      <p class="mt-4 text-center">
        Already have an account? <a href="/login" class="text-blue-600">Login</a>
      </p>
    \`;
  }
}
`;
}

export function forgotPasswordPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ForgotPasswordPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Forgot Password</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Send Reset Link
        </button>
      </form>
      <p class="mt-4 text-center">
        <a href="/login" class="text-blue-600">&larr; Back to Login</a>
      </p>
    \`;
  }
}
`;
}

export function authMiddlewareTemplate() {
  return `import { defineServerMiddleware } from '@cossackframework/core';

/**
 * Auth middleware (STUB).
 * TODO: replace with real session verification using @cossackframework/auth.
 * Currently passes every request through. The public paths below are skipped
 * so login/register/forgot-password remain reachable.
 */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password'];

export const authMiddleware = defineServerMiddleware(async (c, next) => {
  const { path } = c.req;
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }
  // TODO: verify session/cookie here; e.g.:
  //   const session = await verifySession(c);
  //   if (!session) return c.redirect('/login');
  await next();
});
`;
}

/** Minimal root layout that applies the auth middleware (created by `add auth`). */
export function rootLayoutWithAuthTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { authMiddleware } from '../middlewares/auth';

@Page({ transport: 'http', middlewares: [authMiddleware] })
export default class RootLayout extends Cossack {
  render() {
    return html\`
      <div class="min-h-screen">
        \${this.children}
      </div>
    \`;
  }
}
`;
}

/**
 * Default English catalog shipped by `cossack lang publish`. Demonstrates
 * placeholder replacement and pluralization so the feature is immediately
 * useful; users edit/extend freely.
 */
export function defaultLangCatalog() {
  return {
    welcome: 'Welcome to :name',
    goodbye: 'Goodbye, :Name',
    apples: 'You have :count apple|You have :count apples',
    'I love programming.': 'I love programming.',
  };
}

/**
 * Starter catalog JSON for a locale. `publish` uses the populated English
 * template; `add <locale>` reuses this with empty strings so translators can
 * fill in values while keeping the key set in sync.
 *
 * @param entries  key → value map (values may be '' for the `add` stub)
 */
export function langJsonTemplate(entries) {
  return JSON.stringify(entries, null, 2) + '\n';
}

// ===========================================================================
// Database stubs (`cossack add database` + `cossack generate model|migration|seeder`)
// ===========================================================================

/** `src/models/User.ts` — default User model + Database/User augmentations. */
export function userModelTemplate() {
  return `import type { Generated } from '@cossackframework/database';

/**
 * The \`users\` table row shape. Add columns here as your app grows.
 */
export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Generated<string>;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}

// Expose a safe subset as \`this.user\` / \`c.get('user')\`.
// \`passwordHash\` is intentionally excluded from the request context.
declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
  }
}
`;
}

/** A blank migration file generated by `cossack generate migration <name>`. */
export function migrationTemplate() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  // TODO: forward migration — e.g. db.schema.createTable(...).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // TODO: reverse the migration above.
}
`;
}

/** A blank seeder file generated by `cossack generate seeder <name>`. */
export function seederTemplate() {
  return `import type { DbClient } from '@cossackframework/database';

export default {
  async run(db: DbClient) {
    // TODO: seed your database — e.g.
    // await db.insertInto('users').values({ email: 'demo@cossack.dev' }).execute();
  },
};
`;
}

/** `src/middlewares/db.ts` — the database request middleware (instantiated + exported). */
export function dbMiddlewareFileTemplate() {
  return `import { createDbMiddleware } from '@cossackframework/database';
import { createClient } from '../db/config';

// Exposes the Kysely client on the request (\`c.get('db')\` / \`getDb(c)\`) and
// scopes the global \`db()\` helper to it. Register it from src/config/middlewares.ts.
export const dbMiddleware = createDbMiddleware({
  client: (c) => createClient(c.env),
});
`;
}

/** `src/db/config.ts` for the Cloudflare D1 dialect. */
export function dbConfigD1Template() {
  return `import {
  createDatabase,
  createDbMiddleware,
  type DbClient,
} from '@cossackframework/database';

/**
 * Build a per-request Kysely client from the D1 binding. Wire this into your
 * app entry (src/index.ts) via createApp({ dbMiddleware: createDbMiddleware({ client: (c) => createClient(c.env) }) }).
 */
export function createClient(env: { DB: D1Database }): DbClient {
  return createDatabase({ dialect: 'd1', binding: env.DB });
}

/**
 * Build a Kysely client for the CLI (migrations & seeders).
 *
 * D1 itself only exists inside a Worker, so for local migration development we
 * open a local SQLite file (same dialect) with better-sqlite3. Install it once:
 *
 *   pnpm add -D better-sqlite3
 *
 * Set D1_LOCAL_PATH to point at your wrangler local D1 file (under
 * .wrangler/state/v3/d1/...) or any scratch path. Defaults to ./local.db.
 *
 * The same migration files run unchanged against D1 in production.
 */
export async function getCliClient(): Promise<DbClient> {
  const localPath = process.env.D1_LOCAL_PATH ?? './local.db';
  const { Kysely, SqliteDialect } = await import('@cossackframework/database');
  const Database = (await import('better-sqlite3')).default;
  return new Kysely({ dialect: new SqliteDialect({ database: new Database(localPath) }) }) as DbClient;
}
`;
}

/** `src/db/config.ts` for the Turso / libSQL dialect. */
export function dbConfigTursoTemplate() {
  return `import {
  createDatabase,
  createDbMiddleware,
  type DbClient,
} from '@cossackframework/database';
import { createClient } from '@tursodatabase/serverless/compat';
// Fallback driver (battle-tested, same API):
// import { createClient } from '@libsql/client/web';

/**
 * Build a per-request Kysely client. Wire this into your app entry (src/index.ts):
 *
 *   createApp({ dbMiddleware: createDbMiddleware({ client: (c) => createClient(c.env) }) })
 */
export function createClient(env: { TURSO_URL: string; TURSO_TOKEN?: string }): DbClient {
  return createDatabase({
    dialect: 'libsql',
    client: createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
  });
}

/**
 * Build a Kysely client for the CLI (migrations & seeders). Reads the same
 * TURSO_URL / TURSO_TOKEN env vars (set them in .dev.vars or your shell).
 */
export async function getCliClient(): Promise<DbClient> {
  return createClient({
    TURSO_URL: process.env.TURSO_URL!,
    TURSO_TOKEN: process.env.TURSO_TOKEN,
  });
}
`;
}

// --- Default migrations shipped by \`cossack add database\` -------------------

export function createUsersMigration() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text')
    .addColumn('password_hash', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
`;
}

export function createSessionsMigration() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sessions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sessions').ifExists().execute();
}
`;
}

export function createRolesMigration() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('roles')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('roles').ifExists().execute();
}
`;
}

export function createPermissionsMigration() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('permissions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .execute();

  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('permission_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('role_permissions_pkey', ['role_id', 'permission_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('role_permissions').ifExists().execute();
  await db.schema.dropTable('permissions').ifExists().execute();
}
`;
}

export function createOauthAccountsMigration() {
  return `import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('oauth_accounts')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('provider_user_id', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addUniqueConstraint('oauth_accounts_provider_user_unique', ['provider', 'provider_user_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('oauth_accounts').ifExists().execute();
}
`;
}
