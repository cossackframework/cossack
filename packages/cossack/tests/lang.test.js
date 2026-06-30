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
});
