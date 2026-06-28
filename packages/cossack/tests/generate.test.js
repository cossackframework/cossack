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
