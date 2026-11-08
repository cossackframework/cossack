import fs from 'node:fs/promises';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

// The template's src/auth-input.ts, with its input contracts stubbed: returnPath is what this tests.
async function authInput() {
  const source = await fs.readFile(new URL('../template/src/auth-input.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const chain = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@cossackframework/core' || name === '@cossackframework/core/input') return { input: chain };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

describe('the page a sign-in returns to', () => {
  it('is a path on this site outside /auth', async () => {
    const { returnPath } = await authInput();
    expect(returnPath('/posts/members-news')).toBe('/posts/members-news');
    expect(returnPath('/shop?tab=orders#latest')).toBe('/shop?tab=orders#latest');
    for (const value of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/auth/login', '/auth', `/a${'b'.repeat(600)}`, '/x\n/y', '', undefined, 42]) {
      expect(returnPath(value), String(value)).toBeNull();
    }
  });
});
