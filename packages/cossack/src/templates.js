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

export function pageTemplate({ className, title, description, withHead }) {
  const headMethod = withHead
    ? `\n  head() {\n    return {\n      title: ${JSON.stringify(
        title,
      )},\n      description: ${JSON.stringify(description)},\n    };\n  }\n`
    : '';

  const body = withHead
    ? `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>${
        description ? `\n        <p class="mt-2 text-gray-600">${description}</p>` : ''
      }\n      </div>`
    : `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>\n      </div>`;

  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class ${className} extends Cossack {${headMethod}
  render() {
    return html\`
      ${body}
    \`;
  }
}
`;
}

export function pageMdxTemplate({ title, description }) {
  const frontmatter = description
    ? `---\ntitle: ${title}\ndescription: ${description}\n---`
    : `---\ntitle: ${title}\n---`;
  return `${frontmatter}

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

export function loginPageTemplate({ loginPath, registerPath, oauthProviders }) {
  const oauthButtons = oauthProviders.length
    ? oauthProviders
        .map(
          (p) =>
            `        <a href="/auth/${p}/redirect" class="block w-full text-center bg-gray-700 hover:bg-gray-800 text-white py-2 px-4 rounded mb-2">Sign in with ${p.charAt(0).toUpperCase() + p.slice(1)}</a>`,
        )
        .join('\n') +
      '\n        <div class="my-4 text-center text-gray-400 text-sm">— or —</div>\n'
    : '';
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { auth, loginUser } from '../../../auth';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
  @State()
  @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
  email = '';

  @State()
  @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }, config: { trigger: 'all', runOn: 'both' } })
  password = '';

  @State() error = '';

  @Client()
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.error = '';
    const ok = await this.validateAll();
    if (!ok) { this.requestUpdate(); return; }
    try {
      await this.login(this.email, this.password);
    } catch (e: any) {
      this.error = e?.message || 'Login failed';
      this.requestUpdate();
    }
  }

  @Server()
  async login(email: string, password: string) {
    const user = await loginUser(this.c, email, password);
    if (!user) { this.error = 'Invalid credentials'; this.requestUpdate(); return; }
    if (auth.createSession) {
      const { headers } = await auth.createSession(user as any, this.c);
      headers.forEach((value, key) => this.c.header(key, value));
    }
    this.redirect('/dashboard');
  }

  render() {
    return html\`
      <h3 class="mb-4">Login</h3>
${oauthButtons}      <form @submit="\${(e: Event) => this.handleSubmit(e)}">
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" .value="\${this.email}" @input="\${(e: any) => this.setProperty('email', e.target.value)}" class="w-full p-2 border rounded" placeholder="user@example.com" />
          \${this.hasError('email') ? html\`<span class="text-red-500 text-sm">\${this.getError('email')}</span>\` : ''}
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" .value="\${this.password}" @input="\${(e: any) => this.setProperty('password', e.target.value)}" class="w-full p-2 border rounded" />
          \${this.hasError('password') ? html\`<span class="text-red-500 text-sm">\${this.getError('password')}</span>\` : ''}
        </div>
        \${this.error ? html\`<div class="mb-4 text-red-500 text-sm">\${this.error}</div>\` : ''}
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Sign In</button>
      </form>
      <p class="mt-4 text-center">
        Don't have an account? <a href="${registerPath}" class="text-blue-600">Register</a>
      </p>
    \`;
  }
}
`;
}

export function registerPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { auth, registerUser } from '../../../auth';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
  @State()
  name = '';

  @State()
  @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
  email = '';

  @State()
  @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }, config: { trigger: 'all', runOn: 'both' } })
  password = '';

  @State() error = '';

  @Client()
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.error = '';
    const ok = await this.validateAll();
    if (!ok) { this.requestUpdate(); return; }
    try {
      await this.register(this.name, this.email, this.password);
    } catch (e: any) {
      this.error = e?.message || 'Registration failed';
      this.requestUpdate();
    }
  }

  @Server()
  async register(name: string, email: string, password: string) {
    const user = await registerUser(this.c, email, password, name || undefined);
    if (auth.createSession) {
      const { headers } = await auth.createSession(user as any, this.c);
      headers.forEach((value, key) => this.c.header(key, value));
    }
    this.redirect('/dashboard');
  }

  render() {
    return html\`
      <h3 class="mb-4">Register</h3>
      <form @submit="\${(e: Event) => this.handleSubmit(e)}">
        <div class="mb-4">
          <label class="block mb-2">Name</label>
          <input type="text" .value="\${this.name}" @input="\${(e: any) => this.setProperty('name', e.target.value)}" class="w-full p-2 border rounded" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" .value="\${this.email}" @input="\${(e: any) => this.setProperty('email', e.target.value)}" class="w-full p-2 border rounded" />
          \${this.hasError('email') ? html\`<span class="text-red-500 text-sm">\${this.getError('email')}</span>\` : ''}
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" .value="\${this.password}" @input="\${(e: any) => this.setProperty('password', e.target.value)}" class="w-full p-2 border rounded" />
          \${this.hasError('password') ? html\`<span class="text-red-500 text-sm">\${this.getError('password')}</span>\` : ''}
        </div>
        \${this.error ? html\`<div class="mb-4 text-red-500 text-sm">\${this.error}</div>\` : ''}
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Create Account</button>
      </form>
      <p class="mt-4 text-center">
        Already have an account? <a href="${loginPath}" class="text-blue-600">Login</a>
      </p>
    \`;
  }
}
`;
}

export function forgotPasswordPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { requestPasswordReset } from '../../../auth';

@Page({ transport: 'http' })
export default class ForgotPasswordPage extends Cossack {
  @State()
  @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'all', runOn: 'both' } })
  email = '';

  @State() submitted = false;

  @Client()
  async handleSubmit(event: Event) {
    event.preventDefault();
    const ok = await this.validateAll();
    if (!ok) { this.requestUpdate(); return; }
    await this.requestReset(this.email);
    this.submitted = true;
    this.requestUpdate();
  }

  @Server()
  async requestReset(email: string) {
    // Build the reset base URL from the request origin.
    const origin = new URL(this.c.req.url).origin;
    await requestPasswordReset(this.c, email, origin);
  }

  render() {
    return html\`
      <h3 class="mb-4">Forgot Password</h3>
      \${this.submitted
        ? html\`<p class="mb-4">If an account exists for that email, a reset link has been sent.</p>\`
        : html\`<form @submit="\${(e: Event) => this.handleSubmit(e)}">
            <div class="mb-4">
              <label class="block mb-2">Email</label>
              <input type="email" .value="\${this.email}" @input="\${(e: any) => this.setProperty('email', e.target.value)}" class="w-full p-2 border rounded" />
              \${this.hasError('email') ? html\`<span class="text-red-500 text-sm">\${this.getError('email')}</span>\` : ''}
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Send Reset Link</button>
          </form>\`}
      <p class="mt-4 text-center">
        <a href="${loginPath}" class="text-blue-600">&larr; Back to Login</a>
      </p>
    \`;
  }
}
`;
}

export function resetPasswordPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { resetPassword } from '../../../auth';

@Page({ transport: 'http' })
export default class ResetPasswordPage extends Cossack {
  @State()
  @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }, config: { trigger: 'all', runOn: 'both' } })
  password = '';

  @State() error = '';

  private get token(): string {
    return this.c?.req?.query('token') ?? '';
  }

  @Client()
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.error = '';
    const ok = await this.validateAll();
    if (!ok) { this.requestUpdate(); return; }
    try {
      await this.doReset(this.token, this.password);
    } catch (e: any) {
      this.error = e?.message || 'Reset failed';
      this.requestUpdate();
    }
  }

  @Server()
  async doReset(token: string, password: string) {
    const ok = await resetPassword(this.c, token, password);
    if (!ok) { this.error = 'Invalid or expired reset link'; this.requestUpdate(); return; }
    this.redirect('${loginPath}');
  }

  render() {
    return html\`
      <h3 class="mb-4">Reset Password</h3>
      <form @submit="\${(e: Event) => this.handleSubmit(e)}">
        <div class="mb-4">
          <label class="block mb-2">New Password</label>
          <input type="password" .value="\${this.password}" @input="\${(e: any) => this.setProperty('password', e.target.value)}" class="w-full p-2 border rounded" />
          \${this.hasError('password') ? html\`<span class="text-red-500 text-sm">\${this.getError('password')}</span>\` : ''}
        </div>
        \${this.error ? html\`<div class="mb-4 text-red-500 text-sm">\${this.error}</div>\` : ''}
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Reset Password</button>
      </form>
    \`;
  }
}
`;
}

export function authMiddlewareTemplate({ publicPaths, loginPath }) {
  const pathsLiteral = publicPaths.map((p) => JSON.stringify(p)).join(', ');
  return `import { defineServerMiddleware } from '@cossackframework/core';
import { auth } from '../auth';

/**
 * Auth guard generated by \`cossack add auth\`.
 *
 * - \`auth.middleware\` (registered in src/bootstrap/middlewares.ts) populates
 *   \`c.get('user')\` for every request.
 * - This guard then redirects unauthenticated requests to ${loginPath},
 *   except for the public paths below.
 */
const PUBLIC_PATHS = [${pathsLiteral}];

export const authGuard = defineServerMiddleware(async (c, next) => {
  const { path } = c.req;
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }
  const user = c.get('user');
  if (!user) {
    return c.redirect('${loginPath}');
  }
  await next();
});
`;
}

/**
 * Minimal root layout created by `add auth` if `src/pages/layout.ts` is absent.
 * Global middleware (auth session + guard) is registered separately in
 * `src/bootstrap/middlewares.ts`, so this layout only renders children.
 */
export function rootLayoutWithAuthTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
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
 * The \`users\` table row shape. Column names match the migration (snake_case).
 * Add columns here as your app grows.
 */
export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string | null;
  password_hash: string | null;
  created_at: Generated<string>;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}

// Expose a safe subset as \`this.user\` / \`c.get('user')\`.
// \`password_hash\` is intentionally excluded from the request context.
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
  return `import { createDbMiddleware, DatabaseCacheStore } from '@cossackframework/database';
import { extendCacheDriver } from '@cossackframework/framework/cache';
import { createClient } from '../db/config';

// Exposes the Kysely client on the request (\`c.get('db')\` / \`getDb(c)\`) and
// scopes the global \`db()\` helper to it. Register it from src/bootstrap/middlewares.ts.
export const dbMiddleware = createDbMiddleware({
  client: (c) => createClient(c.env),
});

// Register the database cache driver so \`CACHE_DRIVER=database\` works.
// Remove this (and the 'database' store in config/cache.ts) if you don't use
// database-backed caching, or swap it for your own driver (Redis, R2, …).
extendCacheDriver('database', () => new DatabaseCacheStore());
`;
}

/** `src/db/config.ts` for the Cloudflare D1 dialect. */
export function dbConfigD1Template() {
  return `import {
  createDatabase,
  type DbClient,
} from '@cossackframework/database';

/**
 * Build a per-request Kysely client from the D1 binding.
 * Used by src/middlewares/db.ts which is registered in src/bootstrap/middlewares.ts.
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
  type DbClient,
} from '@cossackframework/database';
import { createClient as createTursoClient } from '@tursodatabase/serverless/compat';
// Fallback driver (battle-tested, same API):
// import { createClient as createTursoClient } from '@libsql/client/web';

/**
 * Build a per-request Kysely client.
 * Used by src/middlewares/db.ts which is registered in src/bootstrap/middlewares.ts.
 */
export function createClient(env: { TURSO_URL: string; TURSO_TOKEN?: string }): DbClient {
  return createDatabase({
    dialect: 'libsql',
    client: createTursoClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
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
    // user_id is nullable so anonymous sessions (carts, wizards, A/B) work
    // without auth. Authenticated sessions set it on login.
    .addColumn('user_id', 'text')
    // data holds a JSON key/value bag for general-purpose session storage
    // (the session() helper). Nullable until first write.
    .addColumn('data', 'text')
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

// --- Cache table migration (shipped by default via `cossack add database`) ----

/**
 * Migration stub for the database cache driver's `cache_items` table.
 * Included as migration 0006 in the default set; apply with `cossack migration up`.
 */
export function createCacheTableMigration() {
  return `import type { Kysely } from '@cossackframework/database';

// Table for the database cache driver (@cossackframework/database's
// DatabaseCacheStore). Values are JSON text; expires_at is epoch milliseconds
// (NULL = never expires). The 'database' cache driver is registered by the
// default project template in src/middlewares/db.ts — set CACHE_DRIVER=database
// to use it.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('cache_items')
    .addColumn('key', 'text', (c) => c.primaryKey().notNull())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer')
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute();

  // Speed up purgeExpired() (WHERE expires_at < now).
  await db.schema
    .createIndex('cache_items_expires_at_index')
    .on('cache_items')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('cache_items_expires_at_index').ifExists().execute();
  await db.schema.dropTable('cache_items').ifExists().execute();
}
`;
}

// ===========================================================================
// Auth feature templates (`cossack add auth`)
// ===========================================================================

/** `src/models/Session.ts` — sessions table row + Database augmentation. */
export function sessionModelTemplate() {
  return `/**
 * The \`sessions\` table row shape (snake_case to match the migration).
 * user_id is nullable for anonymous sessions; data is a JSON key/value bag.
 */
export interface SessionRow {
  id: string;
  user_id: string | null;
  data: string | null;
  expires_at: string;
}

declare module '@cossackframework/database' {
  interface Database {
    sessions: SessionRow;
  }
}
`;
}

/**
 * `src/auth.ts` — a working session-auth module generated by \`cossack add auth\`.
 *
 * Uses \`createAuth\` from \`@cossackframework/auth\` (session middleware +
 * reusable \`createSession\`) backed by the Kysely client exposed via
 * \`c.get('db')\`. Passwords are hashed with PBKDF2 (Web Crypto) — no extra
 * dependency, runs on Cloudflare Workers and Node.
 *
 * @param publicPaths  route paths the auth guard should leave unprotected
 * @param loginPath    where unauthenticated requests redirect to
 */
export function authModuleTemplate({ publicPaths, loginPath, oauthProviders }) {
  const hasOauth = oauthProviders.length > 0;
  const providerConfig = oauthProviders
    .map(
      (p) =>
        `    ${p}: {\n      clientId: process.env.${p.toUpperCase()}_CLIENT_ID!,\n      clientSecret: process.env.${p.toUpperCase()}_CLIENT_SECRET!,\n      redirectUrl: \`/auth/${p}/callback\`,\n    },`,
    )
    .join('\n');

  const oauthBlock = hasOauth
    ? `
// --- OAuth ----------------------------------------------------------------
// Mount in src/index.ts:
//   app.get('/auth/<provider>/redirect', oauth.redirect('<provider>'));
//   app.get('/auth/<provider>/callback', oauth.callback('<provider>', { onUser }));
export const oauth = createOAuth({
  secret: process.env.OAUTH_SECRET!,
  providers: {
${providerConfig}
  },
});

/**
 * Map an OAuth user into your app's User and start a session. Reuses
 * \`auth.createSession\` so the cookie path is identical to password login.
 */
export async function handleOAuthUser(oauthUser: OAuthUser, _tokens: TokenSet, c: Context) {
  // TODO: upsert the user and link the oauth_account (see create_oauth_accounts migration).
  const user = { id: oauthUser.id, email: oauthUser.email ?? '', name: oauthUser.name ?? '' };
  if (auth.createSession) {
    const { headers } = await auth.createSession(user as any, c);
    headers.forEach((value, key) => c.header(key, value));
  }
  return c.redirect('/dashboard');
}
`
    : '';

  return `import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth ${hasOauth ? ', createOAuth, type OAuthUser, type TokenSet' : ''} } from '@cossackframework/auth';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// --- Password hashing (PBKDF2 / Web Crypto, no extra deps) -----------------
const ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return \`pbkdf2$\${toHex(salt.buffer)}$\${toHex(key)}\`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const key = await deriveKey(password, salt);
  // Constant-time-ish compare.
  const a = toHex(key);
  if (a.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    KEY_LENGTH * 8,
  );
}

// --- Types (snake_case to match the migrations) ----------------------------
interface UserRow { id: string; email: string; name: string | null; password_hash: string | null; }
interface SessionRow { id: string; user_id: string; expires_at: string; }

function db(c: Context) {
  const d = (c as any).get('db');
  if (!d) throw new Error('Database not available — register dbMiddleware in src/bootstrap/middlewares.ts.');
  return d;
}

function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name ?? '' };
}

// --- Session create / validate / resolve ----------------------------------
async function createSessionRow(c: Context, user: UserRow): Promise<{ headers: Headers }> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db(c).insertInto('sessions').values({ id, user_id: user.id, expires_at }).execute();
  const headers = new Headers();
  setCookie(headers, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return { headers };
}

export const auth = createAuth<{ id: string; email: string; name: string }>({
  extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
  validateSessionId: async (sessionId, c) => {
    const row = await db(c)
      .selectFrom('sessions')
      .where('id', '=', sessionId)
      .where('expires_at', '>', new Date().toISOString())
      .select('user_id')
      .executeTakeFirst() as SessionRow | undefined;
    return row?.user_id ?? null;
  },
  resolveUserById: async (userId, c) => {
    const row = await db(c)
      .selectFrom('users')
      .where('id', '=', userId)
      .select(['id', 'email', 'name'])
      .executeTakeFirst() as UserRow | undefined;
    return row ? publicUser(row) : null;
  },
  createSession: async (user, c) => {
    const full = await db(c)
      .selectFrom('users')
      .where('id', '=', user.id)
      .selectAll()
      .executeTakeFirst() as UserRow | undefined;
    if (!full) throw new Error('User not found');
    return createSessionRow(c, full);
  },
});

// --- Credential helpers (used by the page @Server methods) -----------------
export async function loginUser(c: Context, email: string, password: string) {
  const row = await db(c).selectFrom('users').where('email', '=', email).selectAll().executeTakeFirst() as
    | UserRow
    | undefined;
  if (!row || !row.password_hash) return null;
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? publicUser(row) : null;
}

export async function registerUser(c: Context, email: string, password: string, name?: string) {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db(c)
    .insertInto('users')
    .values({ id, email, name: name ?? null, password_hash: passwordHash, created_at: new Date().toISOString() })
    .execute();
  return { id, email, name: name ?? '' };
}

// --- Password reset (uses the sessions table for tokens) -------------------
async function createPasswordResetToken(c: Context, email: string): Promise<string | null> {
  const user = await db(c).selectFrom('users').where('email', '=', email).select('id').executeTakeFirst() as
    | { id: string }
    | undefined;
  if (!user) return null; // do NOT leak whether the email exists
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  await db(c).insertInto('sessions').values({ id: token, user_id: user.id, expires_at }).execute();
  return token;
}

async function consumePasswordResetToken(c: Context, token: string): Promise<string | null> {
  const row = await db(c)
    .selectFrom('sessions')
    .where('id', '=', token)
    .where('expires_at', '>', new Date().toISOString())
    .select('user_id')
    .executeTakeFirst() as SessionRow | undefined;
  if (!row) return null;
  await db(c).deleteFrom('sessions').where('id', '=', token).execute();
  return row.user_id;
}

export async function requestPasswordReset(c: Context, email: string, resetBaseUrl: string) {
  const token = await createPasswordResetToken(c, email);
  if (!token) return; // silently no-op for unknown emails
  const env = (c as any).env ?? {};
  const from = env.MAIL_FROM ?? 'no-reply@example.com';
  const resetUrl = \`\${resetBaseUrl.replace(/\\/$/, '')}/\${loginPath.replace('/login', '/reset-password')}?token=\${token}\`;
  const html = \`<p>We received a request to reset your password.</p><p><a href="\${resetUrl}">Reset password</a></p><p>This link expires in 1 hour.</p>\`;
  const text = \`Reset your password: \${resetUrl}\`;
  // env.EMAIL is the Cloudflare send_email binding (or the node-adapter polyfill).
  await env.EMAIL.send({ to: email, from, subject: 'Reset your password', html, text });
}

export async function resetPassword(c: Context, token: string, newPassword: string) {
  const userId = await consumePasswordResetToken(c, token);
  if (!userId) return false;
  const passwordHash = await hashPassword(newPassword);
  await db(c).updateTable('users').set({ password_hash: passwordHash }).where('id', '=', userId).execute();
  return true;
}
${oauthBlock}
`;
}

// ---------------------------------------------------------------------------
// `cossack add ui` — UI component catalog + barrel
//
// All entries use `fromPackage()`, which reads the component source directly
// from the installed @cossackframework/ui package at eject time. This avoids
// duplicating ~600 lines of template strings and eliminates drift between the
// catalog and the package source.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromCli = createRequire(import.meta.url);

/**
 * Read a component's source directly from the installed
 * @cossackframework/ui package. Falls back to a stub if the file can't be
 * resolved (e.g. package not yet installed during `cossack add ui` before
 * `pnpm install`).
 */
function ejectFromPackage(className) {
  try {
    const pkgJsonPath = requireFromCli.resolve('@cossackframework/ui/package.json');
    const pkgDir = path.dirname(pkgJsonPath);
    const srcPath = path.join(pkgDir, 'src', 'components', `${className}.ts`);
    return fs.readFileSync(srcPath, 'utf8');
  } catch {
    return `// Run \`pnpm install\` then re-run \`cossack add ui ${className.toLowerCase()}\`
// to eject the full source from @cossackframework/ui.
export {};\n`;
  }
}

/** Wrapper so the catalog entry shape stays consistent: { className, template }. */
const fromPackage = (className) => () => ejectFromPackage(className);

/**
 * Catalog of ejectable UI components. Keys are the names accepted by
 * `cossack add ui <name>`.
 */
export const UI_COMPONENTS = {
  button: { className: 'Button', template: fromPackage('Button') },
  input: { className: 'Input', template: fromPackage('Input') },
  card: { className: 'Card', template: fromPackage('Card') },
  badge: { className: 'Badge', template: fromPackage('Badge') },
  label: { className: 'Label', template: fromPackage('Label') },
  alert: { className: 'Alert', template: fromPackage('Alert') },
  modal: { className: 'Modal', template: fromPackage('Modal') },
  accordion: { className: 'Accordion', template: fromPackage('Accordion') },
  textarea: { className: 'Textarea', template: fromPackage('Textarea') },
  checkbox: { className: 'Checkbox', template: fromPackage('Checkbox') },
  switch: { className: 'Switch', template: fromPackage('Switch') },
  select: { className: 'Select', template: fromPackage('Select') },
  spinner: { className: 'Spinner', template: fromPackage('Spinner') },
  avatar: { className: 'Avatar', template: fromPackage('Avatar') },
  separator: { className: 'Separator', template: fromPackage('Separator') },
  skeleton: { className: 'Skeleton', template: fromPackage('Skeleton') },
  progress: { className: 'Progress', template: fromPackage('Progress') },
  tabs: { className: 'Tabs', template: fromPackage('Tabs') },
  tooltip: { className: 'Tooltip', template: fromPackage('Tooltip') },
  popover: { className: 'Popover', template: fromPackage('Popover') },
  'radio-group': { className: 'RadioGroup', template: fromPackage('RadioGroup') },
  slider: { className: 'Slider', template: fromPackage('Slider') },
  table: { className: 'Table', template: fromPackage('Table') },
  toaster: { className: 'Toaster', template: fromPackage('Toaster') },
  'dropdown-menu': { className: 'DropdownMenu', template: fromPackage('DropdownMenu') },
  sheet: { className: 'Sheet', template: fromPackage('Sheet') },
  collapsible: { className: 'Collapsible', template: fromPackage('Collapsible') },
  toggle: { className: 'Toggle', template: fromPackage('Toggle') },
  'toggle-group': { className: 'ToggleGroup', template: fromPackage('ToggleGroup') },
  breadcrumb: { className: 'Breadcrumb', template: fromPackage('Breadcrumb') },
  pagination: { className: 'Pagination', template: fromPackage('Pagination') },
  'aspect-ratio': { className: 'AspectRatio', template: fromPackage('AspectRatio') },
  field: { className: 'Field', template: fromPackage('Field') },
  empty: { className: 'Empty', template: fromPackage('Empty') },
  kbd: { className: 'Kbd', template: fromPackage('Kbd') },
  'button-group': { className: 'ButtonGroup', template: fromPackage('ButtonGroup') },
  'alert-dialog': { className: 'AlertDialog', template: fromPackage('AlertDialog') },
  'hover-card': { className: 'HoverCard', template: fromPackage('HoverCard') },
  'scroll-area': { className: 'ScrollArea', template: fromPackage('ScrollArea') },
  resizable: { className: 'Resizable', template: fromPackage('Resizable') },
  carousel: { className: 'Carousel', template: fromPackage('Carousel') },
  'navigation-menu': { className: 'NavigationMenu', template: fromPackage('NavigationMenu') },
  menubar: { className: 'Menubar', template: fromPackage('Menubar') },
  command: { className: 'Command', template: fromPackage('Command') },
  combobox: { className: 'Combobox', template: fromPackage('Combobox') },
};

/** src/components/ui barrel re-exporting everything from the package. */
export function uiBarrelTemplate() {
  return `// Re-export the full UI package so imports stay stable whether or not
// individual components are ejected via \`cossack add ui <component>\`.
export {
    Button,
    Input,
    Card,
    CardHeader,
    CardBody,
    CardFooter,
    Badge,
    Label,
    Alert,
    Modal,
    Accordion,
    AccordionItem,
    Textarea,
    Checkbox,
    Switch,
    Select,
    Spinner,
    Avatar,
    Separator,
    Skeleton,
    Progress,
    Tabs,
    Tooltip,
    Popover,
    RadioGroup,
    Slider,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    Toaster,
    DropdownMenu,
    Sheet,
    Collapsible,
    Toggle,
    ToggleGroup,
    Breadcrumb,
    Pagination,
    AspectRatio,
    Field,
    Empty,
    Kbd,
    ButtonGroup,
    AlertDialog,
    HoverCard,
    ScrollArea,
    Resizable,
    Carousel,
    NavigationMenu,
    Menubar,
    Command,
    Combobox,
    Icon,
} from '@cossackframework/ui';
`;
}
