import 'reflect-metadata';
/**
 * Pins how often the security plugin reads and Oxc-parses modules. Behaviour
 * is covered by vite-security-plugin.test.ts; these tests only guard the
 * work done per module, so they count calls instead of timing them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const calls = vi.hoisted(() => ({ parses: 0, reads: [] as string[] }));

vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();
  return {
    ...actual,
    parseSync: ((...args: Parameters<typeof actual.parseSync>) => {
      calls.parses++;
      return actual.parseSync(...args);
    }) as typeof actual.parseSync,
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((path: any, ...rest: any[]) => {
    calls.reads.push(String(path));
    return (actual.readFileSync as any)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

const { cossackSecurityPlugin } = await import('../src/vite-security-plugin');

/** Valid TypeScript that load() would treat as server-only if it parsed it. */
const SERVER_ONLY_TEXT = `import { readFileSync } from 'node:fs';\nexport const leaked = readFileSync;\n`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cossack-parse-count-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function file(relative: string, source: string): string {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
  return path;
}

async function load(id: string, environment = 'client') {
  const plugin = cossackSecurityPlugin();
  calls.parses = 0;
  calls.reads.length = 0;
  const result = await (plugin.load as Function).call({ environment: { name: environment } }, id);
  return { result, parses: calls.parses, reads: calls.reads.length };
}

describe('security plugin load() only inspects script modules', () => {
  it.each([
    ['an image', 'src/assets/logo.png', ''],
    ['a stylesheet', 'src/style.css', ''],
    ['a raw text import', 'src/content/notes.md', '?raw'],
    ['an inline stylesheet', 'src/pages/theme.css', '?inline'],
    ['an asset URL import', 'src/assets/icon.svg', '?url'],
    ['a JSON module', 'src/data/items.json', '?import'],
    ['a font', 'src/assets/font.woff2', ''],
  ])('does not read or parse %s', async (_label, relative, query) => {
    const path = file(relative, SERVER_ONLY_TEXT);
    const { result, parses, reads } = await load(`${path}${query}`);
    expect(result).toBeUndefined();
    expect(reads).toBe(0);
    expect(parses).toBe(0);
  });

  it('does not touch the file system for virtual modules', async () => {
    const { result, parses, reads } = await load('\0virtual:cossack-generated.ts');
    expect(result).toBeUndefined();
    expect(reads).toBe(0);
    expect(parses).toBe(0);
  });

  it('still stubs server-only JavaScript and query-suffixed TypeScript modules', async () => {
    const js = await load(file('src/lib/files.js', SERVER_ONLY_TEXT));
    expect(js.result).toContain('export const leaked = stub');
    const raw = await load(`${file('src/lib/files.ts', SERVER_ONLY_TEXT)}?raw`);
    expect(raw.result).toContain('export const leaked = stub');
  });
});

describe('security plugin load() parses each module once', () => {
  it('reads and parses a server-only component page once and leaves it to transform()', async () => {
    const path = file('src/pages/users/index.ts', `
      import { Cossack, Page, Server } from '@cossackframework/core';
      import { sql } from '@cossackframework/database';
      @Page()
      export default class Users extends Cossack {
        @Server() async load() { return sql\`select 1\`; }
        render() { return ''; }
      }
    `);
    const { result, parses, reads } = await load(path);
    expect(result).toBeUndefined();
    expect(reads).toBe(1);
    expect(parses).toBe(1);
  });

  it('reads and parses a server-only service once while stubbing it', async () => {
    const path = file('src/services/users.ts', `
      import { randomUUID } from 'node:crypto';
      export const createId = () => randomUUID();
      export function listUsers() { return []; }
    `);
    const { result, parses, reads } = await load(`${path}?import`);
    expect(result).toContain('export const createId = stub');
    expect(result).toContain('export const listUsers = stub');
    expect(reads).toBe(1);
    expect(parses).toBe(1);
  });

  it('reads and parses a functional HTTP route once while stubbing it', async () => {
    const path = file('src/pages/api/hello/index.ts', `
      export const GET = () => new Response('secret body');
      export const POST = () => new Response('ok');
    `);
    const { result, parses, reads } = await load(path);
    expect(result).toContain('"GET"');
    expect(result).not.toContain('secret body');
    expect(reads).toBe(1);
    expect(parses).toBe(1);
  });

  it('reads and parses src/auth.ts once while stubbing it', async () => {
    const path = file('src/auth.ts', `
      import { createAuth } from '@cossackframework/auth';
      export const auth = createAuth({});
      export async function loginUser() {}
    `);
    const { result, parses, reads } = await load(path);
    expect(result).toContain('export const auth = { middleware');
    expect(result).toContain('export const loginUser = stub');
    expect(reads).toBe(1);
    expect(parses).toBe(1);
  });

  it('stubs config modules without reading them', async () => {
    const path = file('src/config/database.ts', `export default { url: env('DATABASE_URL') };`);
    const { result, parses, reads } = await load(path);
    expect(result).toBe('export default {};\n');
    expect(reads).toBe(0);
    expect(parses).toBe(0);
  });
});
