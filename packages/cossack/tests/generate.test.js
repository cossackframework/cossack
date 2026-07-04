import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateCommand } from '../src/commands/generate.js';
import { deleteCommand } from '../src/commands/delete.js';

let tmp;
let ctx;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-gen-'));
  ctx = { projectRoot: tmp, cwd: tmp, flags: {}, force: false, dryRun: false };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('generate page', () => {
  it('creates folder index.ts with class + decorator', async () => {
    const code = await generateCommand(['p', 'my-page'], ctx);
    expect(code).toBe(0);
    const file = path.join(tmp, 'src/pages/my-page/index.ts');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('@Page()');
    expect(content).toContain('export default class MyPagePage extends Cossack');
  });

  it('supports nested path', async () => {
    await generateCommand(['p', '/dashboard/my-page'], ctx);
    expect(
      fs.existsSync(path.join(tmp, 'src/pages/dashboard/my-page/index.ts')),
    ).toBe(true);
  });

  it('supports custom md extension', async () => {
    await generateCommand(['p', 'my-page.md'], ctx);
    const file = path.join(tmp, 'src/pages/my-page/index.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^---\ntitle:/);
  });

  it('refuses overwrite without --force', async () => {
    expect(await generateCommand(['p', 'x'], ctx)).toBe(0);
    expect(await generateCommand(['p', 'x'], ctx)).toBe(1);
  });

  it('overwrites with --force', async () => {
    await generateCommand(['p', 'x'], ctx);
    ctx.force = true;
    expect(await generateCommand(['p', 'x'], ctx)).toBe(0);
  });

  it('dry-run writes nothing', async () => {
    ctx.dryRun = true;
    await generateCommand(['p', 'x'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/pages/x/index.ts'))).toBe(false);
  });

  it('--head adds a head() method with default title/description', async () => {
    ctx.flags = { head: true };
    await generateCommand(['p', 'my-page'], ctx);
    const file = path.join(tmp, 'src/pages/my-page/index.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('head() {');
    expect(content).toContain('title: "My Page"');
    expect(content).toContain('description: "My Page"');
    expect(content).toContain('<h1 class="text-2xl font-bold">My Page</h1>');
    expect(content).toContain('<p class="mt-2 text-gray-600">My Page</p>');
  });

  it('--title/--description override head() values', async () => {
    ctx.flags = { title: 'My Custom Title', description: 'My custom description' };
    await generateCommand(['p', 'x'], ctx);
    const content = fs.readFileSync(
      path.join(tmp, 'src/pages/x/index.ts'),
      'utf8',
    );
    expect(content).toContain('head() {');
    expect(content).toContain('title: "My Custom Title"');
    expect(content).toContain('description: "My custom description"');
    expect(content).toContain('<h1 class="text-2xl font-bold">My Custom Title</h1>');
    expect(content).toContain(
      '<p class="mt-2 text-gray-600">My custom description</p>',
    );
  });

  it('--description on a .md page adds frontmatter description', async () => {
    ctx.flags = { description: 'custom desc' };
    await generateCommand(['p', 'x.md'], ctx);
    const content = fs.readFileSync(path.join(tmp, 'src/pages/x/index.md'), 'utf8');
    expect(content).toMatch(/^---\ntitle:/);
    expect(content).toMatch(/description: custom desc/);
  });

  it('default (no --head) omits head() method', async () => {
    await generateCommand(['p', 'plain'], ctx);
    const content = fs.readFileSync(
      path.join(tmp, 'src/pages/plain/index.ts'),
      'utf8',
    );
    expect(content).not.toContain('head() {');
  });

  it('--no-index generates a flat file instead of a directory', async () => {
    ctx.flags = { 'no-index': true };
    await generateCommand(['p', 'hello'], ctx);
    // flat file exists, no folder/index
    expect(fs.existsSync(path.join(tmp, 'src/pages/hello.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/hello/index.ts'))).toBe(false);
    const content = fs.readFileSync(path.join(tmp, 'src/pages/hello.ts'), 'utf8');
    expect(content).toContain('export default class HelloPage extends Cossack');
  });

  it('--ni alias works and supports nested + md', async () => {
    ctx.flags = { ni: true };
    await generateCommand(['p', '/docs/intro.md'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/pages/docs/intro.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'src/pages/docs/intro/index.md'))).toBe(false);
  });
});

describe('generate component / service / middleware / layout', () => {
  it('component (pascal file + named export)', async () => {
    await generateCommand(['c', 'user-widget'], ctx);
    const file = path.join(tmp, 'src/components/UserWidget.ts');
    expect(fs.existsSync(file)).toBe(true);
    const c = fs.readFileSync(file, 'utf8');
    expect(c).toContain('@Component()');
    expect(c).toContain('export class UserWidget extends Cossack');
  });

  it('service (pascal + Service suffix)', async () => {
    await generateCommand(['s', 'counter'], ctx);
    const file = path.join(tmp, 'src/services/CounterService.ts');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      'export class CounterService',
    );
  });

  it('middleware (kebab file + camel export)', async () => {
    await generateCommand(['m', 'request-logger'], ctx);
    const file = path.join(tmp, 'src/middlewares/request-logger.ts');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      'export const requestLoggerMiddleware',
    );
  });

  it('layout (folder layout.ts)', async () => {
    await generateCommand(['l', 'dashboard'], ctx);
    const file = path.join(tmp, 'src/pages/dashboard/layout.ts');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain(
      "export default class DashboardLayout",
    );
  });

  it('layout nested path -> src/pages/<segments>/<leaf>/layout.ts', async () => {
    // Router-correct colocated convention: only src/pages/**/layout.ts is
    // discovered by the framework (vite-plugin.ts). A separate src/layouts/
    // dir would be silently ignored.
    await generateCommand(['l', 'admin/dashboard'], ctx);
    const file = path.join(tmp, 'src/pages/admin/dashboard/layout.ts');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('export default class DashboardLayout');
    expect(content).toContain('@Page({ transport: \'http\' })');
  });
});

describe('aliases', () => {
  it('single-letter type aliases resolve (p/c/l/m/s)', async () => {
    expect(await generateCommand(['p', 'p1'], ctx)).toBe(0);
    expect(await generateCommand(['c', 'c1'], ctx)).toBe(0);
    expect(await generateCommand(['l', 'l1'], ctx)).toBe(0);
    expect(await generateCommand(['m', 'm1'], ctx)).toBe(0);
    expect(await generateCommand(['s', 's1'], ctx)).toBe(0);
  });

  it('unknown type errors', async () => {
    expect(await generateCommand(['z', 'nope'], ctx)).toBe(1);
  });
});

describe('delete', () => {
  it('removes a page file and cleans up empty dir', async () => {
    await generateCommand(['p', 'gone'], ctx);
    const file = path.join(tmp, 'src/pages/gone/index.ts');
    expect(fs.existsSync(file)).toBe(true);

    ctx.force = true; // skip prompt
    const code = await deleteCommand(['p', 'gone'], ctx);
    expect(code).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'src/pages/gone'))).toBe(false);
  });

  it('keeps the dir if it still has other source files', async () => {
    await generateCommand(['p', 'mixed'], ctx);
    // add a layout alongside
    fs.writeFileSync(
      path.join(tmp, 'src/pages/mixed/layout.ts'),
      '// layout',
    );
    ctx.force = true;
    await deleteCommand(['p', 'mixed'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/pages/mixed/layout.ts'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmp, 'src/pages/mixed'))).toBe(true);
  });

  it('errors when target missing', async () => {
    ctx.force = true;
    expect(await deleteCommand(['p', 'nope'], ctx)).toBe(1);
  });

  it('removes a flat (--no-index) page file', async () => {
    ctx.flags = { 'no-index': true };
    await generateCommand(['p', 'flat'], ctx);
    const file = path.join(tmp, 'src/pages/flat.ts');
    expect(fs.existsSync(file)).toBe(true);
    // reset flags for delete
    ctx.flags = {};
    ctx.force = true;
    const code = await deleteCommand(['p', 'flat'], ctx);
    expect(code).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('deletes component / service / middleware', async () => {
    await generateCommand(['c', 'widget'], ctx);
    await generateCommand(['s', 'auth'], ctx);
    await generateCommand(['m', 'log'], ctx);
    ctx.force = true;
    expect(await deleteCommand(['c', 'widget'], ctx)).toBe(0);
    expect(await deleteCommand(['s', 'auth'], ctx)).toBe(0);
    expect(await deleteCommand(['m', 'log'], ctx)).toBe(0);
  });
});

describe('generate model / migration / seeder', () => {
  it('creates a typed User model under src/models/', async () => {
    expect(await generateCommand(['model', 'User'], ctx)).toBe(0);
    const file = path.join(tmp, 'src/models/User.ts');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('export interface UserRow');
    expect(content).toContain("declare module '@cossackframework/database'");
    expect(content).toContain("declare module '@cossackframework/core'");
  });

  it('creates a timestamped migration under src/migrations/', async () => {
    expect(await generateCommand(['migration', 'create_posts'], ctx)).toBe(0);
    const dir = path.join(tmp, 'src/migrations');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}_\d{2}_\d{2}_\d{6}_create_posts\.ts$/);
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    expect(content).toContain('export async function up');
    expect(content).toContain('export async function down');
  });

  it('creates a seeder under src/seeders/', async () => {
    expect(await generateCommand(['seeder', 'users'], ctx)).toBe(0);
    const file = path.join(tmp, 'src/seeders/users.ts');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('export default');
    expect(content).toContain('async run(db');
  });
});
