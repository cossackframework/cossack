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

const { cossackSecurityPlugin, inspectCompilerMethods } = await import('../src/vite-security-plugin');

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

/** A page without server-only members: the client transform leaves it as is. */
const CLIENT_ONLY_PAGE = `
  import { Cossack, Page, Client, html } from '@cossackframework/core';
  @Page()
  export default class Counter extends Cossack {
    count = 0;
    @Client() increment() { this.count++; }
    render() { return html\`<button @click=\${this.increment}>\${this.count}</button>\`; }
  }
`;

/** A page whose @Server bodies are stubbed and whose helper import is then unused. */
const SERVER_PAGE = `
  import { Cossack, Page, Server, html } from '@cossackframework/core';
  import { listUsers } from '../../services/users';
  @Page()
  export default class Users extends Cossack {
    users: string[] = [];
    @Server() async load(): Promise<string[]> { return listUsers(); }
    @Server() async remove(id: string): Promise<void> { await listUsers(id); }
    render() { return html\`<p>\${this.users.length}</p>\`; }
  }
`;

function transform(code: string, id: string, environment = 'client', plugin = cossackSecurityPlugin()) {
  calls.parses = 0;
  const result = (plugin.transform as Function).call({ environment: { name: environment }, warn: () => {} }, code, id);
  return { code: result.code as string, parses: calls.parses };
}

describe('security plugin transform() parses each module once', () => {
  const id = '/app/src/pages/users/index.ts';

  it('parses a module the client transform leaves unchanged once', () => {
    const result = transform(CLIENT_ONLY_PAGE, id);
    expect(result.code).toBe(CLIENT_ONLY_PAGE);
    expect(result.parses).toBe(1);
  });

  it('parses a stripped module once, plus once for its stubbed source', () => {
    // Stubs move every later offset, and the unused-dependency pass must see
    // the stubbed bodies' references, so it parses the stubbed source. Typed
    // @Server return types are classified from the module AST, not re-parsed.
    const result = transform(SERVER_PAGE, id);
    expect(result.code).not.toContain('listUsers');
    expect(result.code).toContain('RpcCall');
    expect(result.parses).toBe(2);
  });

  it('re-parses for the server-only import pass only when the module has a server-only import', () => {
    const page = SERVER_PAGE.replace(`import { listUsers } from '../../services/users';`,
      `import { listUsers } from '../../services/users';\n  import { sql } from '@cossackframework/database';`)
      .replace('return listUsers();', 'return sql`select name from users`;');
    const result = transform(page, id);
    expect(result.code).not.toContain('@cossackframework/database');
    // Original, stubbed source, and the source after unused imports were removed.
    expect(result.parses).toBe(3);
  });

  it('parses once in the server environment', () => {
    expect(transform(SERVER_PAGE, id, 'ssr').parses).toBe(1);
  });

  it('reuses the load() parse, so load and transform together parse an unchanged module once', async () => {
    const path = file('src/pages/counter/index.ts', CLIENT_ONLY_PAGE);
    const plugin = cossackSecurityPlugin();
    calls.parses = 0;
    expect(await (plugin.load as Function).call({ environment: { name: 'client' } }, path)).toBeUndefined();
    const loadParses = calls.parses;
    const result = transform(CLIENT_ONLY_PAGE, path, 'client', plugin);
    expect(loadParses).toBe(1);
    expect(result.parses).toBe(0);
    expect(result.code).toBe(CLIENT_ONLY_PAGE);

    const serverPath = file('src/pages/users/index.ts', SERVER_PAGE);
    await (plugin.load as Function).call({ environment: { name: 'client' } }, serverPath);
    expect(transform(SERVER_PAGE, serverPath, 'client', plugin).parses).toBe(1);
  });

  it('parses the source transform() receives when it differs from what load() read', async () => {
    const path = file('src/pages/users/index.ts', CLIENT_ONLY_PAGE);
    const plugin = cossackSecurityPlugin();
    await (plugin.load as Function).call({ environment: { name: 'client' } }, path);
    const result = transform(SERVER_PAGE, path, 'client', plugin);
    expect(result.code).toBe(transform(SERVER_PAGE, path).code);
    expect(result.code).not.toContain('listUsers');
    expect(result.parses).toBe(2);
  });

  it('parses a module without server$ once for compiler inspection', () => {
    calls.parses = 0;
    const facts = inspectCompilerMethods(SERVER_PAGE, id);
    expect(facts.classes[0].methods.map(method => method.name)).toEqual(['load', 'remove', 'render']);
    expect(calls.parses).toBe(1);
  });
});
