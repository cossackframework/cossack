import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { langCommand } from '../src/commands/lang.js';

let tmp;
let ctx;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-lang-'));
  ctx = { projectRoot: tmp, cwd: tmp, flags: {}, force: false, dryRun: false };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readLang(locale) {
  return JSON.parse(
    fs.readFileSync(path.join(tmp, 'src', 'lang', `${locale}.json`), 'utf8'),
  );
}

describe('lang publish', () => {
  it('creates src/lang/en.json with starter keys', async () => {
    const code = await langCommand(['publish'], ctx);
    expect(code).toBe(0);
    const file = path.join(tmp, 'src/lang/en.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = readLang('en');
    expect(parsed).toHaveProperty('welcome');
    expect(parsed).toHaveProperty('apples');
    // Pluralization string kept intact.
    expect(parsed.apples).toContain('|');
  });

  it('refuses to overwrite without --force', async () => {
    expect(await langCommand(['publish'], ctx)).toBe(0);
    // Second run skips and reports success (exit 0 with exists message).
    expect(await langCommand(['publish'], ctx)).toBe(0);
    // Ensure original contents preserved.
    const parsed = readLang('en');
    expect(parsed).toHaveProperty('welcome');
  });

  it('overwrites with --force', async () => {
    await langCommand(['publish'], ctx);
    // Corrupt the file; --force should restore the starter catalog.
    fs.writeFileSync(
      path.join(tmp, 'src/lang/en.json'),
      '{ "changed": true }',
      'utf8',
    );
    ctx.force = true;
    expect(await langCommand(['publish'], ctx)).toBe(0);
    const parsed = readLang('en');
    expect(parsed).toHaveProperty('welcome');
    expect(parsed).not.toHaveProperty('changed');
  });

  it('respects --locale=<code> for a non-default locale', async () => {
    expect(await langCommand(['publish', '--locale=es'], ctx)).toBe(0);
    const file = path.join(tmp, 'src/lang/es.json');
    expect(fs.existsSync(file)).toBe(true);
    // Non-default locales seed empty values against the starter keys.
    const parsed = readLang('es');
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(['welcome', 'apples']),
    );
    expect(parsed.welcome).toBe('');
  });

  it('mirrors an existing en.json when publishing another locale', async () => {
    await langCommand(['publish'], ctx);
    // Customize en.json before publishing es.
    fs.writeFileSync(
      path.join(tmp, 'src/lang/en.json'),
      JSON.stringify({ custom: 'Custom' }) + '\n',
      'utf8',
    );
    expect(await langCommand(['publish', '--locale=es'], ctx)).toBe(0);
    const parsed = readLang('es');
    expect(Object.keys(parsed)).toEqual(['custom']);
    expect(parsed.custom).toBe('');
  });

  it('dry-run writes nothing', async () => {
    ctx.dryRun = true;
    await langCommand(['publish'], ctx);
    expect(fs.existsSync(path.join(tmp, 'src/lang/en.json'))).toBe(false);
  });
});

describe('lang add', () => {
  it('creates an empty catalog for a new locale', async () => {
    await langCommand(['publish'], ctx); // establish en first
    expect(await langCommand(['add', 'fr'], ctx)).toBe(0);
    const parsed = readLang('fr');
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(['welcome', 'apples']),
    );
    expect(parsed.welcome).toBe('');
  });

  it('reports exists and stays silent-success on a repeat', async () => {
    await langCommand(['publish'], ctx);
    expect(await langCommand(['add', 'fr'], ctx)).toBe(0);
    expect(await langCommand(['add', 'fr'], ctx)).toBe(0);
  });

  it('overwrites with --force', async () => {
    await langCommand(['publish'], ctx);
    await langCommand(['add', 'fr'], ctx);
    // Mutate the fr file.
    fs.writeFileSync(
      path.join(tmp, 'src/lang/fr.json'),
      '{ "touched": true }',
      'utf8',
    );
    ctx.force = true;
    expect(await langCommand(['add', 'fr'], ctx)).toBe(0);
    const parsed = readLang('fr');
    expect(parsed).toHaveProperty('welcome');
    expect(parsed).not.toHaveProperty('touched');
  });

  it('rejects adding the default locale (use publish)', async () => {
    expect(await langCommand(['add', 'en'], ctx)).toBe(1);
  });

  it('errors when no locale is provided', async () => {
    expect(await langCommand(['add'], ctx)).toBe(1);
  });

  it('supports --locale=<code> form', async () => {
    await langCommand(['publish'], ctx);
    expect(await langCommand(['add', '--locale=de'], ctx)).toBe(0);
    expect(fs.existsSync(path.join(tmp, 'src/lang/de.json'))).toBe(true);
  });
});

describe('lang dispatch', () => {
  it('prints help and returns 0', async () => {
    expect(await langCommand(['--help'], ctx)).toBe(0);
    expect(await langCommand(['help'], ctx)).toBe(0);
  });

  it('errors on an unknown subcommand', async () => {
    expect(await langCommand(['bogus'], ctx)).toBe(1);
  });

  it('treats init as an alias for publish', async () => {
    expect(await langCommand(['init'], ctx)).toBe(0);
    expect(fs.existsSync(path.join(tmp, 'src/lang/en.json'))).toBe(true);
  });

  it('prefers an explicit project root over an ancestor package', async () => {
    const projectRoot = path.join(tmp, 'requested-project');
    const ancestor = path.join(tmp, 'other-project');
    const cwd = path.join(ancestor, 'nested');
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(
      path.join(ancestor, 'package.json'),
      JSON.stringify({ name: 'other-project' }),
    );

    expect(await langCommand(['publish'], {
      ...ctx,
      projectRoot,
      cwd,
    })).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, 'src/lang/en.json'))).toBe(true);
    expect(fs.existsSync(path.join(ancestor, 'src/lang/en.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publish auto-wiring (root.ts + wrangler.jsonc)
// ---------------------------------------------------------------------------
function writeFile(rel, content) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function readFile(rel) {
  return fs.readFileSync(path.join(tmp, rel), 'utf8');
}

describe('lang publish auto-wires root.ts', () => {
  it('replaces <html lang="en"> with {{ cossackLang }}', async () => {
    writeFile(
      'src/root.ts',
      'export const template = `<html lang="en"><body>{{ cossackBody }}</body></html>`;',
    );
    await langCommand(['publish'], ctx);
    expect(readFile('src/root.ts')).toContain('{{ cossackLang }}');
    expect(readFile('src/root.ts')).not.toContain('<html lang="en">');
  });

  it('skips when already wired', async () => {
    writeFile(
      'src/root.ts',
      'export const template = `<html lang="{{ cossackLang }}"><body>{{ cossackBody }}</body></html>`;',
    );
    await langCommand(['publish'], ctx);
    // Still has the placeholder, unchanged.
    expect(readFile('src/root.ts')).toContain('{{ cossackLang }}');
  });

  it('prints a note when root.ts has no <html lang> tag', async () => {
    writeFile('src/root.ts', 'export const template = `<div>no html tag</div>`;');
    await langCommand(['publish'], ctx);
    expect(readFile('src/root.ts')).not.toContain('{{ cossackLang }}');
  });

  it('prints a note when root.ts does not exist', async () => {
    // No root.ts created — the publish command should note its absence.
    expect(await langCommand(['publish'], ctx)).toBe(0);
  });

  it('respects --dry-run', async () => {
    writeFile('src/root.ts', 'export const template = `<html lang="en"></html>`;');
    ctx.dryRun = true;
    await langCommand(['publish'], ctx);
    expect(readFile('src/root.ts')).toContain('<html lang="en">');
    expect(readFile('src/root.ts')).not.toContain('{{ cossackLang }}');
  });
});

describe('lang publish auto-wires wrangler.jsonc', () => {
  it('adds APP_LOCALE to an existing vars block', async () => {
    writeFile(
      'wrangler.jsonc',
      '{\n  "name": "test",\n  "vars": {\n    "BASE_URL": "https://example.com"\n  }\n}\n',
    );
    await langCommand(['publish'], ctx);
    const wrangler = readFile('wrangler.jsonc');
    expect(wrangler).toContain('APP_LOCALE');
    expect(wrangler).toContain('"en"');
  });

  it('skips when APP_LOCALE is already present', async () => {
    writeFile(
      'wrangler.jsonc',
      '{\n  "vars": {\n    "APP_LOCALE": "es"\n  }\n}\n',
    );
    await langCommand(['publish'], ctx);
    // Should not have added a duplicate or changed the value.
    const wrangler = readFile('wrangler.jsonc');
    expect(wrangler.match(/APP_LOCALE/g)).toHaveLength(1);
    expect(wrangler).toContain('"es"');
  });

  it('skips silently when there is no wrangler.jsonc (Node adapter)', async () => {
    // No wrangler.jsonc — should not error.
    expect(await langCommand(['publish'], ctx)).toBe(0);
  });

  it('uses the --locale value for APP_LOCALE', async () => {
    writeFile(
      'wrangler.jsonc',
      '{\n  "vars": {\n    "BASE_URL": "https://example.com"\n  }\n}\n',
    );
    await langCommand(['publish', '--locale=es'], ctx);
    expect(readFile('wrangler.jsonc')).toContain('"APP_LOCALE": "es"');
  });
});
