import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/e2e-build.mjs', import.meta.url));
const { buildSignature, canReuseBuild } = await import(/* @vite-ignore */ script) as {
  buildSignature(root: string, environment?: Record<string, string>): string;
  canReuseBuild(root: string, expected: string): boolean;
};

let directory: string;
let root: string;
function write(file: string, contents: string) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cossack-e2e-build-'));
  root = join(directory, 'packages/framework');
  write('src/page.ts', 'export const value = 1;');
  write('../core/dist/nested/index.js', 'export const value = 1;');
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

it('reuses a build after identical workspace output gets a new timestamp', () => {
  const expected = buildSignature(root, {});
  const file = write('../core/dist/nested/index.js', 'export const value = 1;');
  const later = new Date(Date.now() + 60_000);
  utimesSync(file, later, later);
  expect(buildSignature(root, {})).toBe(expected);
});

it('invalidates changed source even when size and timestamps stay the same', () => {
  const file = join(root, 'src/page.ts');
  const { atime, mtime, size } = statSync(file);
  const expected = buildSignature(root, {});
  write('src/page.ts', 'export const value = 2;');
  utimesSync(file, atime, mtime);
  expect(statSync(file).size).toBe(size);
  expect(buildSignature(root, {})).not.toBe(expected);
});

it.each(['../core/dist/nested/index.js', '../renderer/dist/index.js', '../ui/dist/index.js',
  '../core/package.json', '../renderer/package.json', '../ui/package.json',
  'vite.config.ts', 'dev/devtools.ts', 'scripts/e2e-build.mjs', '../../pnpm-lock.yaml'])
  ('invalidates changed build input %s', file => {
    write(file, 'before');
    const expected = buildSignature(root, {});
    write(file, 'after');
    expect(buildSignature(root, {})).not.toBe(expected);
  });

it.each(['.env', '.env.production.local', '.dev.vars', '.dev.vars.staging'])
  ('invalidates added or changed environment file %s', file => {
    const missing = buildSignature(root, {});
    write(file, 'APP_URL=https://before.test');
    const before = buildSignature(root, {});
    expect(before).not.toBe(missing);
    write(file, 'APP_URL=https://after.test');
    expect(buildSignature(root, {})).not.toBe(before);
  });

it.each(['APP_URL', 'APP_LOCALE', 'CLOUDFLARE_ENV'])
  ('invalidates changed build environment %s', name => {
    expect(buildSignature(root, { [name]: 'after' }))
      .not.toBe(buildSignature(root, { [name]: 'before' }));
  });

it('tracks a custom Wrangler configuration outside the application', () => {
  const file = '../../custom/wrangler.jsonc';
  write(file, '{"name":"before"}');
  const environment = { CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: file };
  const expected = buildSignature(root, environment);
  write(file, '{"name":"after"}');
  expect(buildSignature(root, environment)).not.toBe(expected);
});

it('requires a matching stamp and all production entry files before reusing output', () => {
  const expected = buildSignature(root, {});
  expect(canReuseBuild(root, expected)).toBe(false);
  const files = ['dist/client/cossack-manifest.json', 'dist/client/cossack-routes.json',
    'dist/ssr/index.js', 'dist/ssr/wrangler.json'];
  for (const file of files) write(file, '{}');
  expect(canReuseBuild(root, expected)).toBe(false);
  write('dist/.e2e-build-stamp', expected);
  expect(canReuseBuild(root, expected)).toBe(true);
  expect(canReuseBuild(root, 'stale')).toBe(false);
  for (const file of files) {
    rmSync(join(root, file));
    expect(canReuseBuild(root, expected)).toBe(false);
    write(file, '{}');
  }
});
