/**
 * Stub content generators for `cossack generate` and `cossack add`.
 *
 * Simple templates (page, component, middleware, migrations, etc.) are loaded
 * from `.stub` files in `src/stubs/` via `loadStub()`. Complex templates with
 * conditional sections (auth pages, auth module) remain as JS functions.
 *
 * Conventions mirror the framework's own source:
 *   pages    : @Page() class extends Cossack, default export
 *   layouts  : @Page({ transport: 'http' }) class extends Cossack, default export
 *   components: @Component() class extends Cossack, named export
 *   services : @Service() class (no extends)
 *   middleware: defineServerMiddleware, named camelCase export
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a `.stub` file and substitute `{{variable}}` placeholders.
 * @param {string} name  — filename within `src/stubs/` (e.g. `'page.ts.stub'`)
 * @param {Record<string, string>} [vars]  — values to inject
 * @returns {string} the file content with placeholders replaced
 */
export function loadStub(name, vars = {}) {
  const raw = readFileSync(join(__dirname, 'stubs', name), 'utf-8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// --- core generators (loaded from .stub files) ------------------------------

export function pageTemplate({ className, title, description, withHead }) {
  const headMethod = withHead
    ? `\n  head() {\n    return {\n      title: ${JSON.stringify(title)},\n      description: ${JSON.stringify(description)},\n    };\n  }\n`
    : '';
  const body = withHead
    ? `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>${
        description ? `\n        <p class="mt-2 text-gray-600">${description}</p>` : ''
      }\n      </div>`
    : `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>\n      </div>`;
  return loadStub('page.ts.stub', { className, headMethod, body });
}

export function pageMdxTemplate({ title, description }) {
  // MDX frontmatter is too simple to warrant a .stub file — inline is clearer.
  const frontmatter = description
    ? `---\ntitle: ${title}\ndescription: ${description}\n---`
    : `---\ntitle: ${title}\n---`;
  return `${frontmatter}\n\n# ${title}\n\nEdit this page at \`src/pages/<name>/index.mdx\`.\n`;
}

export function componentTemplate({ className, propsName }) {
  return loadStub('component.ts.stub', { className, propsName });
}

export function layoutTemplate({ className, kebab }) {
  return loadStub('layout.ts.stub', { className, kebab });
}

export function middlewareTemplate({ exportName }) {
  return loadStub('middleware.ts.stub', { exportName });
}

export function serviceTemplate({ className }) {
  return loadStub('service.ts.stub', { className });
}

// --- auth feature stubs -----------------------------------------------------

export function authLayoutTemplate() {
  return loadStub('auth-layout.ts.stub');
}

export function loginPageTemplate({ loginPath, registerPath, oauthProviders }) {
  const oauthButtons = oauthProviders.length
    ? oauthProviders
        .map(
          (p) =>
            `        \${component(Button, { variant: 'outline', block: true, '?disabled': false }, html\`<a href="/auth/${p}/redirect" class="block w-full text-center">Sign in with ${p.charAt(0).toUpperCase() + p.slice(1)}</a>\`)}`,
        )
        .join('\n') +
      '\n        <div class="my-4 text-center text-muted-foreground text-sm">— or —</div>\n'
    : '';
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
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
    const user = await loginUser(email, password);
    if (!user) { this.error = 'Invalid credentials'; this.requestUpdate(); return; }
    if (auth.createSession) {
      const { headers } = await auth.createSession(user as any, this.c);
      headers.forEach((value, key) => this.c.header(key, value));
    }
    this.redirect('/dashboard');
  }

  render() {
    return html\`
      <h3 class="mb-6 text-xl font-semibold text-foreground">Login</h3>
${oauthButtons}      <form @submit="\${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
        \${component(Field, { label: 'Email', for: 'email', error: this.getError('email') },
          component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
        \${component(Field, { label: 'Password', for: 'password', error: this.getError('password') },
          component(PasswordInput, { value: this.password, onChange: (v: string) => this.setProperty('password', v) }))}
        \${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
        \${component(Button, { type: 'submit', block: true }, 'Sign In')}
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground">
        Don't have an account? <a href="${registerPath}" class="text-primary font-medium hover:underline">Register</a>
      </p>
    \`;
  }
}
`;
}

export function registerPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, PasswordInput, Button, Alert } from '@cossackframework/ui';
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
    const user = await registerUser(email, password, name || undefined);
    if (auth.createSession) {
      const { headers } = await auth.createSession(user as any, this.c);
      headers.forEach((value, key) => this.c.header(key, value));
    }
    this.redirect('/dashboard');
  }

  render() {
    return html\`
      <h3 class="mb-6 text-xl font-semibold text-foreground">Register</h3>
      <form @submit="\${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
        \${component(Field, { label: 'Name', for: 'name' },
          component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}
        \${component(Field, { label: 'Email', for: 'email', error: this.getError('email') },
          component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
        \${component(Field, { label: 'Password', for: 'password', error: this.getError('password') },
          component(PasswordInput, { value: this.password, onChange: (v: string) => this.setProperty('password', v) }))}
        \${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
        \${component(Button, { type: 'submit', block: true }, 'Create Account')}
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <a href="${loginPath}" class="text-primary font-medium hover:underline">Login</a>
      </p>
    \`;
  }
}
`;
}

export function forgotPasswordPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, Input, Button, Alert } from '@cossackframework/ui';
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
      <h3 class="mb-6 text-xl font-semibold text-foreground">Forgot Password</h3>
      \${this.submitted
        ? component(Alert, { variant: 'success', title: 'Check your email' },
            'If an account exists for that email, a reset link has been sent.')
        : html\`<form @submit="\${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
            \${component(Field, { label: 'Email', for: 'email', error: this.getError('email') },
              component(Input, { id: 'email', type: 'email', placeholder: 'user@example.com', variant: this.hasError('email') ? 'error' : 'default', '.value': this.email, '@input': (e: any) => this.setProperty('email', e.target.value) }))}
            \${component(Button, { type: 'submit', block: true }, 'Send Reset Link')}
          </form>\`}
      <p class="mt-6 text-center text-sm text-muted-foreground">
        <a href="${loginPath}" class="text-primary font-medium hover:underline">&larr; Back to Login</a>
      </p>
    \`;
  }
}
`;
}

export function resetPasswordPageTemplate({ loginPath }) {
  return `import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Field, PasswordInput, Button, Alert } from '@cossackframework/ui';
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
    const ok = await resetPassword(token, password);
    if (!ok) { this.error = 'Invalid or expired reset link'; this.requestUpdate(); return; }
    this.redirect('${loginPath}');
  }

  render() {
    return html\`
      <h3 class="mb-6 text-xl font-semibold text-foreground">Reset Password</h3>
      <form @submit="\${(e: Event) => this.handleSubmit(e)}" class="space-y-4">
        \${component(Field, { label: 'New Password', for: 'password', error: this.getError('password') },
          component(PasswordInput, { value: this.password, placeholder: '••••••••', onChange: (v: string) => this.setProperty('password', v) }))}
        \${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
        \${component(Button, { type: 'submit', block: true }, 'Reset Password')}
      </form>
    \`;
  }
}
`;
}

export function authMiddlewareTemplate({ publicPaths, loginPath }) {
  // With the inverted guard, every path is public by default and only the
  // listed private paths require authentication. Add the URLs that should be
  // protected here as you build them out.
  return `import { defineServerMiddleware } from '@cossackframework/core';
import { auth } from '../auth';

/**
 * Auth guard generated by \`cossack add auth\`.
 *
 * \`auth.middleware\` (registered in src/bootstrap/middlewares.ts) populates
 * \`c.get('user')\` for every request. This guard then redirects
 * unauthenticated requests away from the private paths below.
 *
 * The logic is intentionally inverted (opt-in private, not opt-out public):
 * list the routes that require login as you build them. Everything else —
 * including the auth pages themselves and framework endpoints (/crpc, /upload,
 * static assets) — is reachable without a session.
 */
const PRIVATE_PATHS = ['/dashboard'];

export const authGuard = defineServerMiddleware(async (c, next) => {
  const { path } = c.req;
  if (!PRIVATE_PATHS.includes(path)) {
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
  return loadStub('root-layout-auth.ts.stub');
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
  return loadStub('user-model.ts.stub');
}

/** A blank migration file generated by `cossack generate migration <name>`. */
export function migrationTemplate() {
  return loadStub('migration.ts.stub');
}

/** A blank seeder file generated by `cossack generate seeder <name>`. */
export function seederTemplate() {
  return loadStub('seeder.ts.stub');
}

/** `src/middlewares/db.ts` — the database request middleware (instantiated + exported). */
export function dbMiddlewareFileTemplate() {
  return loadStub('db-middleware.ts.stub');
}

/** `src/db/config.ts` for the Cloudflare D1 dialect. */
export function dbConfigD1Template() {
  return loadStub('db-config-d1.ts.stub');
}

/** `src/db/config.ts` for the Turso / libSQL dialect. */
export function dbConfigTursoTemplate() {
  return loadStub('db-config-turso.ts.stub');
}

// --- Default migrations shipped by `cossack add database` -------------------

export function createUsersMigration() {
  return loadStub('migration-users.ts.stub');
}

export function createSessionsMigration() {
  return loadStub('migration-sessions.ts.stub');
}

export function createRolesMigration() {
  return loadStub('migration-roles.ts.stub');
}

export function createPermissionsMigration() {
  return loadStub('migration-permissions.ts.stub');
}

export function createOauthAccountsMigration() {
  return loadStub('migration-oauth-accounts.ts.stub');
}

// --- Cache table migration (shipped by default via `cossack add database`) ----

export function createCacheTableMigration() {
  return loadStub('migration-cache-table.ts.stub');
}

// ===========================================================================
// Auth feature templates (`cossack add auth`)
// ===========================================================================

/** `src/models/Session.ts` — sessions table row + Database augmentation. */
export function sessionModelTemplate() {
  return loadStub('session-model.ts.stub');
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
  // Reset path mirrors the login path with the final segment swapped, so a
  // custom --path prefix (e.g. /admin/login -> /admin/reset-password) is kept.
  const resetPath = loginPath.replace(/\/login$/, '/reset-password');
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

  return `import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth ${hasOauth ? ', createOAuth, type OAuthUser, type TokenSet' : ''} } from '@cossackframework/auth';
import { db } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';

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

function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name ?? '' };
}

// --- Session create / validate / resolve ----------------------------------
// All DB access uses the global request-scoped db() (reads the per-request
// client from AsyncLocalStorage via the db middleware). No context needed.
async function createSessionRow(user: UserRow): Promise<{ headers: Headers }> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db().insertInto('sessions').values({ id, user_id: user.id, expires_at: expiresAt }).execute();
  // Serialize the Set-Cookie header directly into the returned headers bag so
  // the createAuth contract stays pure (callers apply it to the response).
  const cookieParts = [
    SESSION_COOKIE + '=' + id,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    'Max-Age=' + SESSION_TTL_SECONDS,
  ];
  const headers = new Headers();
  headers.append('Set-Cookie', cookieParts.join('; '));
  return { headers };
}

export const auth = createAuth<{ id: string; email: string; name: string }>({
  extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
  validateSessionId: async (sessionId) => {
    const row = await db()
      .selectFrom('sessions')
      .where('id', '=', sessionId)
      .where('expires_at', '>', new Date().toISOString())
      .select('user_id')
      .executeTakeFirst() as SessionRow | undefined;
    return row?.user_id ?? null;
  },
  resolveUserById: async (userId) => {
    const row = await db()
      .selectFrom('users')
      .where('id', '=', userId)
      .select(['id', 'email', 'name'])
      .executeTakeFirst() as UserRow | undefined;
    return row ? publicUser(row) : null;
  },
  createSession: async (user) => {
    const full = await db()
      .selectFrom('users')
      .where('id', '=', user.id)
      .selectAll()
      .executeTakeFirst() as UserRow | undefined;
    if (!full) throw new Error('User not found');
    return createSessionRow(full);
  },
});

// --- Credential helpers (used by the page @Server methods) -----------------
export async function loginUser(email: string, password: string) {
  const row = await db().selectFrom('users').where('email', '=', email).selectAll().executeTakeFirst() as
    | UserRow
    | undefined;
  if (!row || !row.password_hash) return null;
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? publicUser(row) : null;
}

export async function registerUser(email: string, password: string, name?: string) {
  // Check for an existing email first so we surface a clean, user-facing
  // error instead of letting the raw UNIQUE-constraint rejection bubble up
  // as a generic HTTP 500.
  const existing = await db().selectFrom('users').where('email', '=', email).select('id').executeTakeFirst();
  if (existing) {
    throw new ClientVisibleError('An account with this email already exists.');
  }
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db()
    .insertInto('users')
    .values({ id, email, name: name ?? null, password_hash: passwordHash, created_at: new Date().toISOString() })
    .execute();
  return { id, email, name: name ?? '' };
}

// --- Password reset (uses the sessions table for tokens) -------------------
async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await db().selectFrom('users').where('email', '=', email).select('id').executeTakeFirst() as
    | { id: string }
    | undefined;
  if (!user) return null; // do NOT leak whether the email exists
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  await db().insertInto('sessions').values({ id: token, user_id: user.id, expires_at: expiresAt }).execute();
  return token;
}

async function consumePasswordResetToken(token: string): Promise<string | null> {
  const row = await db()
    .selectFrom('sessions')
    .where('id', '=', token)
    .where('expires_at', '>', new Date().toISOString())
    .select('user_id')
    .executeTakeFirst() as SessionRow | undefined;
  if (!row) return null;
  await db().deleteFrom('sessions').where('id', '=', token).execute();
  return row.user_id;
}

// Unlike the other auth helpers (which use the request-scoped db() global),
// this one still takes c: Context because it accesses c.env.EMAIL (the
// Cloudflare send_email binding / node-adapter polyfill) and c.env.MAIL_FROM.
// There is no global env() equivalent for runtime bindings yet.
export async function requestPasswordReset(c: Context, email: string, resetBaseUrl: string) {
  const token = await createPasswordResetToken(email);
  if (!token) return; // silently no-op for unknown emails
  const env = (c as any).env ?? {};
  const from = env.MAIL_FROM ?? 'no-reply@example.com';
  const resetUrl = \`\${resetBaseUrl.replace(/\\/$/, '')}${resetPath}?token=\${token}\`;
  const html = \`<p>We received a request to reset your password.</p><p><a href="\${resetUrl}">Reset password</a></p><p>This link expires in 1 hour.</p>\`;
  const text = \`Reset your password: \${resetUrl}\`;
  // env.EMAIL is the Cloudflare send_email binding (or the node-adapter polyfill).
  await env.EMAIL.send({ to: email, from, subject: 'Reset your password', html, text });
}

export async function resetPassword(token: string, newPassword: string) {
  const userId = await consumePasswordResetToken(token);
  if (!userId) return false;
  const passwordHash = await hashPassword(newPassword);
  await db().updateTable('users').set({ password_hash: passwordHash }).where('id', '=', userId).execute();
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
  'avatar-group': { className: 'AvatarGroup', template: fromPackage('AvatarGroup') },
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
  form: { className: 'Form', template: fromPackage('Form') },
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
  calendar: { className: 'Calendar', template: fromPackage('Calendar') },
  'date-picker': { className: 'DatePicker', template: fromPackage('DatePicker') },
  'context-menu': { className: 'ContextMenu', template: fromPackage('ContextMenu') },
  'input-otp': { className: 'InputOTP', template: fromPackage('InputOTP') },
  typography: { className: 'Typography', template: fromPackage('Typography') },
  drawer: { className: 'Drawer', template: fromPackage('Drawer') },
  sidebar: { className: 'Sidebar', template: fromPackage('Sidebar') },
  'native-select': { className: 'NativeSelect', template: fromPackage('NativeSelect') },
  'input-group': { className: 'InputGroup', template: fromPackage('InputGroup') },
  item: { className: 'Item', template: fromPackage('Item') },
  bubble: { className: 'Bubble', template: fromPackage('Bubble') },
  message: { className: 'Message', template: fromPackage('Message') },
  'message-scroller': { className: 'MessageScroller', template: fromPackage('MessageScroller') },
  marker: { className: 'Marker', template: fromPackage('Marker') },
  attachment: { className: 'Attachment', template: fromPackage('Attachment') },
  'password-input': { className: 'PasswordInput', template: fromPackage('PasswordInput') },
  'multi-select': { className: 'MultiSelect', template: fromPackage('MultiSelect') },
};

/** src/components/ui barrel re-exporting everything from the package. */
export function uiBarrelTemplate() {
  return loadStub('ui-barrel.ts.stub');
}
