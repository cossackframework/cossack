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
    expect(fs.existsSync(path.join(tmp, 'src/pages/(auth)/layout.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(auth)/login/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(auth)/register/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(auth)/forgot-password/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/(auth)/reset-password/index.ts'))).toBe(true);

    // auth.ts is real (not a stub)
    const auth = fs.readFileSync(path.join(tmp, 'src/auth.ts'), 'utf8');
    expect(auth).toContain('createAuth');
    expect(auth).toContain('hashPassword');
    expect(auth).toContain('loginUser');
    expect(auth).toContain('registerUser');
    expect(auth).toContain('requestPasswordReset');
    expect(auth).toContain('env.EMAIL.send');
    expect(auth).toContain('resetPassword');

    // session model has Database augmentation
    const session = fs.readFileSync(path.join(tmp, 'src/models/Session.ts'), 'utf8');
    expect(session).toContain('SessionRow');
    expect(session).toContain("declare module '@cossackframework/database'");
  });

  it('login/register pages use @Server + @Validate', async () => {
    await addCommand(['auth'], ctx);
    const login = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/login/index.ts'), 'utf8');
    expect(login).toContain('@Server()');
    expect(login).toContain('@Validate(');
    expect(login).toContain('loginUser');
    expect(login).toContain('auth.createSession');
    expect(login).toContain("this.redirect('/dashboard')");

    const register = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/register/index.ts'), 'utf8');
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

  it('adds the UI dependency (auth pages import from @cossackframework/ui)', async () => {
    await addCommand(['auth'], ctx);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cossackframework/ui']).toBeDefined();
    // barrel + theme wiring
    expect(fs.existsSync(path.join(tmp, 'src/components/ui/index.ts'))).toBe(true);
    const css = fs.readFileSync(path.join(tmp, 'src/style.css'), 'utf8');
    expect(css).toContain('@cossackframework/ui/theme/theme.css');
  });

  it('login page uses UI components (Field, Input, PasswordInput, Button)', async () => {
    await addCommand(['auth'], ctx);
    const login = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/login/index.ts'), 'utf8');
    expect(login).toContain("from '@cossackframework/ui'");
    expect(login).toContain('component(Field,');
    expect(login).toContain('component(Input,');
    expect(login).toContain('component(PasswordInput,');
    expect(login).toContain('component(Button,');
  });

  it('auth layout uses Card components instead of raw divs', async () => {
    await addCommand(['auth'], ctx);
    const layout = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/layout.ts'), 'utf8');
    expect(layout).toContain("from '@cossackframework/ui'");
    expect(layout).toContain('Card');
    expect(layout).not.toContain('bg-gray-100');
    expect(layout).not.toContain('bg-white');
  });

  it('--path admin/auth routes pages under src/pages/admin/auth/', async () => {
    ctx.flags = { dialect: 'd1', path: 'admin/auth' };
    await addCommand(['auth'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/pages/admin/auth/login/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/admin/auth/register/index.ts'))).toBe(true);
    const guard = fs.readFileSync(path.join(tmp, 'src/middlewares/auth.ts'), 'utf8');
    expect(guard).toContain("'/admin/auth/login'");
    expect(guard).toContain("c.redirect('/admin/auth/login')");
  });

  it('default (auth) route group is stripped from public auth paths', async () => {
    await addCommand(['auth'], ctx);
    const guard = fs.readFileSync(path.join(tmp, 'src/middlewares/auth.ts'), 'utf8');
    expect(guard).toContain("'/login'");
    expect(guard).not.toContain("'/auth/login'");
    expect(guard).toContain("c.redirect('/login')");
  });

  it('--oauth github generates oauth export + provider buttons', async () => {
    ctx.flags = { dialect: 'd1', oauth: 'github' };
    await addCommand(['auth'], ctx);
    const auth = fs.readFileSync(path.join(tmp, 'src/auth.ts'), 'utf8');
    expect(auth).toContain('createOAuth');
    expect(auth).toContain('GITHUB_CLIENT_ID');
    expect(auth).toContain('handleOAuthUser');
    const login = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/login/index.ts'), 'utf8');
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

  it('forgot-password page calls requestPasswordReset', async () => {
    await addCommand(['auth'], ctx);
    const fp = fs.readFileSync(path.join(tmp, 'src/pages/(auth)/forgot-password/index.ts'), 'utf8');
    expect(fp).toContain('requestPasswordReset');
    expect(fp).toContain('@Server()');
  });
});
