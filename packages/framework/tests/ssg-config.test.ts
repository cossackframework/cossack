// @vitest-environment node
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/**
 * Use createRequire to obtain the real, unshimmed `node:fs`.
 *
 * The framework's vitest configuration inherits the Cloudflare SSR/Workers
 * environment, which replaces `node:fs` with an unenv shim that does not
 * implement the file system. Going through `createRequire` bypasses Vite's
 * SSR resolver so we get the real Node.js built-in.
 */
const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');

import { getSiteUrl, DEFAULT_SITE_URL } from '../src/ssg-config';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ssg-config-'));
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

describe('ssg-config', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    vi.stubEnv('APP_URL', undefined);
    vi.stubEnv('CLOUDFLARE_ENV', undefined);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.each(['wrangler.json', 'wrangler.jsonc'])('uses the build environment from %s', name => {
    writeFile(dir, name, JSON.stringify({
      vars: { APP_URL: 'https://production.test' },
      env: { staging: { vars: { APP_URL: 'https://staging.test' } } },
    }));
    vi.stubEnv('CLOUDFLARE_ENV', 'staging');
    expect(getSiteUrl({ projectRoot: dir })).toBe('https://staging.test');
  });

  it('lets an explicit environment override CLOUDFLARE_ENV', () => {
    writeFile(dir, 'wrangler.jsonc', JSON.stringify({ env: {
      staging: { vars: { APP_URL: 'https://staging.test' } },
      preview: { vars: { APP_URL: 'https://preview.test' } },
    } }));
    vi.stubEnv('CLOUDFLARE_ENV', 'staging');
    expect(getSiteUrl({ projectRoot: dir, environment: 'preview' })).toBe('https://preview.test');
  });

  it.each(['staging', '"staging"', "'staging'"])('reads TOML environment %s', name => {
    writeFile(dir, 'wrangler.toml', `[vars]\nAPP_URL="https://production.test"\n[env.${name}.vars]\nAPP_URL="https://staging.test"`);
    expect(getSiteUrl({ projectRoot: dir, environment: 'staging' })).toBe('https://staging.test');
  });

  it.each(['wrangler.jsonc', 'wrangler.toml'])('never inherits top-level vars from %s for an environment', name => {
    writeFile(dir, name, name.endsWith('jsonc')
      ? '{"vars":{"APP_URL":"https://production.test"},"env":{"staging":{}}}'
      : '[vars]\nAPP_URL="https://production.test"\n[env.staging]');
    writeFile(dir, '.env.staging', 'APP_URL=https://staging.test');
    expect(getSiteUrl({ projectRoot: dir, environment: 'staging' })).toBe('https://staging.test');
  });

  it('resolves environment dotenv files in Cloudflare precedence order', () => {
    writeFile(dir, '.env', 'APP_URL=https://base.test');
    writeFile(dir, '.env.staging', 'APP_URL=https://staging.test');
    writeFile(dir, '.env.local', 'APP_URL=https://local.test');
    expect(getSiteUrl({ projectRoot: dir, environment: 'staging' })).toBe('https://local.test');
    writeFile(dir, '.env.staging.local', 'APP_URL=https://staging-local.test');
    expect(getSiteUrl({ projectRoot: dir, environment: 'staging' })).toBe('https://staging-local.test');
    vi.stubEnv('APP_URL', 'https://explicit.test');
    expect(getSiteUrl({ projectRoot: dir, environment: 'staging' })).toBe('https://explicit.test');
  });

  it('reads APP_URL from wrangler.jsonc (with comments)', () => {
    writeFile(
      dir,
      'wrangler.jsonc',
      `{
        // this is a comment
        "name": "app",
        /* block comment */
        "vars": {
          "APP_URL": "https://wrangler-jsonc.test"
        }
      }`
    );

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://wrangler-jsonc.test');
  });

  it('preserves // inside JSONC string values', () => {
    writeFile(
      dir,
      'wrangler.jsonc',
      `{
        // leading comment
        "name": "https://not-this.test", // trailing comment
        "vars": {
          "APP_URL": "https://preserved.test" // inline
        }
      }`
    );

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://preserved.test');
  });

  it('handles trailing commas in wrangler.jsonc', () => {
    writeFile(
      dir,
      'wrangler.jsonc',
      `{
        "vars": {
          "APP_URL": "https://trailing.test",
        }
      }`
    );

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://trailing.test');
  });

  it('reads APP_URL from wrangler.toml when no .jsonc', () => {
    writeFile(
      dir,
      'wrangler.toml',
      `name = "app"
      # a comment
      [vars]
      APP_URL = "https://wrangler-toml.test"
      `
    );

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://wrangler-toml.test');
  });

  it('reads unquoted TOML value', () => {
    writeFile(
      dir,
      'wrangler.toml',
      `[vars]
      APP_URL = https://bare.test
      `
    );

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://bare.test');
  });

  it('reads APP_URL from .env when no wrangler file', () => {
    writeFile(dir, '.env', `# comment\nAPP_URL=https://dotenv.test\n`);

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://dotenv.test');
  });

  it('strips quotes in .env values', () => {
    writeFile(dir, '.env', `APP_URL="https://quoted.test"\n`);

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://quoted.test');
  });

  it('process.env.APP_URL overrides wrangler.jsonc', () => {
    writeFile(
      dir,
      'wrangler.jsonc',
      `{ "vars": { "APP_URL": "https://wrangler.test" } }`
    );
    vi.stubEnv('APP_URL', 'https://shell.test');

    expect(getSiteUrl({ projectRoot: dir })).toBe('https://shell.test');
  });

  it('returns DEFAULT_SITE_URL when nothing is configured', () => {
    expect(getSiteUrl({ projectRoot: dir })).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe('https://example.com');
  });
});
