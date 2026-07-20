import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addCommand } from '../src/commands/add.js';

let tmp;
let ctx;

/** Scaffold a minimal project so addAuth has package.json + wrangler.jsonc. */
function scaffoldProject() {
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({
      name: 'demo',
      dependencies: { '@cossackframework/framework': '^0.6.0' },
    }),
  );
  fs.writeFileSync(
    path.join(tmp, 'wrangler.jsonc'),
    ['{', '  "name": "demo",', '  "compatibility_flags": ["nodejs_compat"],', '}'].join('\n'),
  );
  fs.writeFileSync(
    path.join(tmp, 'src/index.ts'),
    [
      "import { createApp } from '@cossackframework/framework/router';",
      "import { App } from './App';",
      'const app = createApp({ AppComponent: App });',
      'export default { fetch: app.fetch };',
      '',
    ].join('\n'),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-auth-'));
  ctx = { projectRoot: tmp, cwd: tmp, flags: { dialect: 'd1' }, force: false, dryRun: false };
  scaffoldProject();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('add auth', () => {
  it('scaffolds the auth module, session model, pages, and middleware', async () => {
    const code = await addCommand(['auth'], ctx);
    expect(code).toBe(0);

    // core files
    expect(fs.existsSync(path.join(tmp, 'src/auth.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/models/Session.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/middlewares/auth.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/config/auth.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/auth/layout.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/auth/login/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/auth/register/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/auth/forgot-password/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/auth/reset-password/index.ts'))).toBe(true);
    // dashboard + public chrome
    expect(fs.existsSync(path.join(tmp, 'src/pages/(public)/layout.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(public)/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/layout.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/profile/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/sessions/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'public/logo.svg'))).toBe(true);
    // RBAC: permissions config, uuid helper, models, services, admin pages, seeder.
    expect(fs.existsSync(path.join(tmp, 'src/config/permissions.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/lib/uuid.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/models/Role.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/models/UserRole.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/services/rbac.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/services/users.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/services/roles.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/users/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/users/new/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/users/[id]/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/roles/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/roles/new/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/dashboard/roles/[id]/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/migrations/0007_create_user_roles.ts'))).toBe(true);
    // permissions migration was removed (0004); permissions live on roles now.
    expect(fs.existsSync(path.join(tmp, 'src/migrations/0004_create_permissions.ts'))).toBe(false);

    // auth.ts is real (not a stub)
    const auth = fs.readFileSync(path.join(tmp, 'src/auth.ts'), 'utf8');
    expect(auth).toContain('createAuth');
    expect(auth).toContain('hashPassword');
    expect(auth).toContain('loginUser');
    expect(auth).toContain('registerUser');
    expect(auth).toContain('requestPasswordReset');
    // requestPasswordReset no longer takes c: Context — uses global binding('EMAIL').
    expect(auth).not.toContain('requestPasswordReset(c');
    expect(auth).toContain("binding<");
    expect(auth).toContain("env('MAIL_FROM'");
    expect(auth).toContain('resetPassword');
    // new session-management helpers
    expect(auth).toContain('export async function logout');
    expect(auth).toContain('export async function listUserSessions');
    expect(auth).toContain('export async function revokeSession');
    expect(auth).toContain('export async function revokeAllUserSessions');
    expect(auth).toContain('export async function updateUserProfile');
    // UUIDv7 + RBAC: no more crypto.randomUUID(); roles populated in resolveUserById.
    expect(auth).toContain("from './lib/uuid'");
    expect(auth).not.toContain('crypto.randomUUID');
    expect(auth).toContain('async function loadUserRoles');
    expect(auth).toContain('captureRequestInfo');
    // IP extraction is null-safe: c.req.header('x-forwarded-for')?.split(...)
    // short-circuits the ENTIRE chain (including [0].trim()) to undefined when
    // the header is absent, then falls back to null. No TypeError off-Cloudflare.
    expect(auth).toContain("c.req.header('cf-connecting-ip')");
    expect(auth).toContain("c.req.header('x-forwarded-for')?.split(',')[0].trim()");
    expect(auth).toContain('expiredSessionCookie');
    // CRUD lives in services, not auth.ts.
    expect(auth).not.toContain('export async function listUsers');
    expect(auth).not.toContain('export async function listRoles');

    // session model has Database augmentation + tracking fields
    const session = fs.readFileSync(path.join(tmp, 'src/models/Session.ts'), 'utf8');
    expect(session).toContain('SessionRow');
    expect(session).toContain("declare module '@cossackframework/database'");
    expect(session).toContain('location');
    expect(session).toContain('user_agent');
    expect(session).toContain('ip_address');

    // services carry the CRUD + the authorizer.
    const rbac = fs.readFileSync(path.join(tmp, 'src/services/rbac.ts'), 'utf8');
    expect(rbac).toContain('createAuthorizer');
    expect(rbac).toContain('export const guard');
    const users = fs.readFileSync(path.join(tmp, 'src/services/users.ts'), 'utf8');
    expect(users).toContain('export async function listUsers');
    expect(users).toContain('export async function createUser');
    expect(users).toContain('export async function syncUserRoles');
    const roles = fs.readFileSync(path.join(tmp, 'src/services/roles.ts'), 'utf8');
    expect(roles).toContain('export async function listRoles');
    expect(roles).toContain('export async function createRole');

    // seeder is the admin-seeding version (overwrites the blank one from addDatabase).
    const seeder = fs.readFileSync(path.join(tmp, 'src/seeders/database.seeder.ts'), 'utf8');
    expect(seeder).toContain("name: 'admin'");
    expect(seeder).toContain('ALL_PERMISSIONS');
  });

  it('login/register pages use @Server + @Validate', async () => {
    await addCommand(['auth'], ctx);
    const login = fs.readFileSync(path.join(tmp, 'src/pages/auth/login/index.ts'), 'utf8');
    expect(login).toContain('@Server()');
    expect(login).toContain('@Validate(');
    expect(login).toContain('loginUser');
    expect(login).toContain('auth.createSession');
    // redirects now go through config('auth.redirectAfterLogin'), not a hardcoded /dashboard.
    expect(login).toContain("config('auth.redirectAfterLogin')");
    expect(login).not.toContain("this.redirect('/dashboard')");

    const register = fs.readFileSync(path.join(tmp, 'src/pages/auth/register/index.ts'), 'utf8');
    expect(register).toContain('@Server()');
    expect(register).toContain('registerUser');
  });

  it('registers auth middleware in src/bootstrap/middlewares.ts', async () => {
    await addCommand(['auth'], ctx);
    const mw = fs.readFileSync(path.join(tmp, 'src/bootstrap/middlewares.ts'), 'utf8');
    expect(mw).toContain('auth.middleware');
    expect(mw).toContain('authGuard');
  });

  it('wires the send_email binding into wrangler.jsonc', async () => {
    await addCommand(['auth'], ctx);
    const wr = fs.readFileSync(path.join(tmp, 'wrangler.jsonc'), 'utf8');
    expect(wr).toContain('"send_email"');
    expect(wr).toContain('"name": "EMAIL"');
  });

  it('adds both auth and database dependencies', async () => {
    await addCommand(['auth'], ctx);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cossackframework/auth']).toBeDefined();
    expect(pkg.dependencies['@cossackframework/database']).toBeDefined();
  });

  it('scaffolds auth migrations when database support already exists', async () => {
    fs.mkdirSync(path.join(tmp, 'src/db'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/db/config.ts'), '// existing database config\n');

    await addCommand(['auth'], ctx);

    expect(fs.existsSync(path.join(tmp, 'src/migrations/0002_create_sessions.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/migrations/0003_create_roles.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/migrations/0007_create_user_roles.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'src/db/config.ts'), 'utf8')).toBe(
      '// existing database config\n',
    );
  });

  it('preserves an existing root page and skips the conflicting public root page', async () => {
    fs.mkdirSync(path.join(tmp, 'src/pages'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/pages/index.ts'), '// application landing page\n');

    await addCommand(['auth'], ctx);

    expect(fs.readFileSync(path.join(tmp, 'src/pages/index.ts'), 'utf8')).toBe(
      '// application landing page\n',
    );
    expect(fs.existsSync(path.join(tmp, 'src/pages/(public)/index.ts'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(public)/layout.ts'))).toBe(true);
  });

  it('adds the UI dependency (auth pages import from @cossackframework/ui)', async () => {
    await addCommand(['auth'], ctx);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cossackframework/ui']).toBeDefined();
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).toContain('@cossackframework/ui/theme/theme.css');
  });

  it('login page uses UI components (Field, Input, PasswordInput, Button)', async () => {
    await addCommand(['auth'], ctx);
    const login = fs.readFileSync(path.join(tmp, 'src/pages/auth/login/index.ts'), 'utf8');
    expect(login).toContain("from '@cossackframework/ui'");
    expect(login).toContain('component(Field,');
    expect(login).toContain('component(Input,');
    expect(login).toContain('component(PasswordInput,');
    expect(login).toContain('component(Button,');
  });

  it('auth layout uses Card components and the logo', async () => {
    await addCommand(['auth'], ctx);
    const layout = fs.readFileSync(path.join(tmp, 'src/pages/auth/layout.ts'), 'utf8');
    expect(layout).toContain("from '@cossackframework/ui'");
    expect(layout).toContain('Card');
    expect(layout).toContain('/logo.svg');
  });

  it('--path admin/auth routes pages under src/pages/admin/auth/ and bakes the prefix into config', async () => {
    ctx.flags = { dialect: 'd1', path: 'admin/auth' };
    await addCommand(['auth'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/pages/admin/auth/login/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/admin/auth/register/index.ts'))).toBe(true);
    // The config default redirectAfterLogout mirrors the chosen login path.
    const cfg = fs.readFileSync(path.join(tmp, 'src/config/auth.ts'), 'utf8');
    expect(cfg).toContain("'/admin/auth/login'");
    const guard = fs.readFileSync(path.join(tmp, 'src/middlewares/auth.ts'), 'utf8');
    expect(guard).toContain('"/admin/auth/login"');
    expect(guard).toContain('"/admin/auth/reset-password"');
    expect(guard).not.toContain("path.startsWith('/auth/')");
  });

  it('default auth namespace uses /auth/* paths and config-driven guard', async () => {
    await addCommand(['auth'], ctx);
    const guard = fs.readFileSync(path.join(tmp, 'src/middlewares/auth.ts'), 'utf8');
    // Guest routes are exact matches, leaving OAuth callbacks and endpoints accessible.
    expect(guard).toContain('guestPaths.has(path)');
    expect(guard).toContain('"/auth/login"');
    expect(guard).toContain("path.startsWith('/dashboard')");
    expect(guard).toContain("config('auth.redirectAfterLogin')");
    expect(guard).toContain("config('auth.redirectAfterLogout')");
    const cfg = fs.readFileSync(path.join(tmp, 'src/config/auth.ts'), 'utf8');
    expect(cfg).toContain("env('AUTH_REDIRECT_AFTER_LOGOUT', '/auth/login')");
  });

  it('--oauth github generates oauth export + provider buttons', async () => {
    ctx.flags = { dialect: 'd1', oauth: 'github' };
    await addCommand(['auth'], ctx);
    const auth = fs.readFileSync(path.join(tmp, 'src/auth.ts'), 'utf8');
    expect(auth).toContain('createOAuth');
    expect(auth).toContain('GITHUB_CLIENT_ID');
    expect(auth).toContain('handleOAuthUser');
    const login = fs.readFileSync(path.join(tmp, 'src/pages/auth/login/index.ts'), 'utf8');
    expect(login).toContain('/auth/github/redirect');
    expect(login).toContain('Sign in with Github');
  });

  it('--dry-run writes nothing', async () => {
    ctx.dryRun = true;
    await addCommand(['auth'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/auth.ts'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'src/models/Session.ts'))).toBe(false);
  });

  it('is idempotent on re-run (skips existing files)', async () => {
    expect(await addCommand(['auth'], ctx)).toBe(0);
    // second run should not error and should skip
    const code = await addCommand(['auth'], ctx);
    expect(code).toBe(0);
  });

  it('forgot-password page calls requestPasswordReset without a Context arg', async () => {
    await addCommand(['auth'], ctx);
    const fp = fs.readFileSync(path.join(tmp, 'src/pages/auth/forgot-password/index.ts'), 'utf8');
    expect(fp).toContain('requestPasswordReset');
    expect(fp).toContain('@Server()');
    // No leading Context argument — just (email, origin).
    expect(fp).toContain('await requestPasswordReset(email, origin)');
    expect(fp).not.toContain('requestPasswordReset(this.c');
  });
});
