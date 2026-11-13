import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { transformSync } from 'esbuild';

// The Screen options helpers of the template's src/dashboard/page.ts, without the module's imports.
async function helpers() {
  const source = await fs.readFile(new URL('../template/src/dashboard/page.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source.slice(source.indexOf('/** What a screen\'s options keep')), { loader: 'ts', format: 'cjs', target: 'es2022' });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

it('reads a screen\'s options from its cookie and falls back for anything missing or tampered with', async () => {
  const { screenCookie, screenPreferences, clampPerPage } = await helpers();
  const defaults = { hidden: [], perPage: 20 };
  expect(screenCookie('entries-plugin.tickets')).toBe('cs-screen-entries-plugin_tickets');
  const saved = JSON.stringify({ hidden: ['slug', 'plugin:desk-priority'], perPage: 5 });
  // Hono decodes cookie values; a raw header value is still URI-encoded. Both read the same.
  expect(screenPreferences(saved, defaults)).toEqual({ hidden: ['slug', 'plugin:desk-priority'], perPage: 5 });
  expect(screenPreferences(encodeURIComponent(saved), defaults)).toEqual({ hidden: ['slug', 'plugin:desk-priority'], perPage: 5 });
  expect(screenPreferences(undefined, defaults)).toEqual(defaults);
  expect(screenPreferences('not json', defaults)).toEqual(defaults);
  expect(screenPreferences('%E0%A4%A', defaults)).toEqual(defaults);
  expect(screenPreferences(JSON.stringify({ hidden: 'slug', perPage: 'many' }), defaults)).toEqual(defaults);
  expect(screenPreferences(JSON.stringify({ hidden: ['date', 7, null], perPage: 5000 }), defaults)).toEqual({ hidden: ['date'], perPage: 100 });
  expect(clampPerPage('0', 20)).toBe(20);
  expect(clampPerPage(3.7, 20)).toBe(3);
});
