// Shared infrastructure for the UI browser tests (see vitest.browser.config.ts).
// global-setup.js compiles the standard Tailwind stylesheet once; each test
// file reuses that CSS instead of running a full Tailwind build per fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { chromium } from '@playwright/test';

export const repository = fileURLToPath(new URL('../../../../', import.meta.url));
export const toolRequire = createRequire(new URL('../../package.json', import.meta.url));

/** The stylesheet most fixtures write: Tailwind + UI theme, scanning only packages/ui/src. */
export function standardStyle() {
  return `
@import ${JSON.stringify(toolRequire.resolve('tailwindcss/index.css'))} source(none);
@import ${JSON.stringify(path.join(repository, 'packages/ui/src/theme/base.css'))};
@import ${JSON.stringify(path.join(repository, 'packages/ui/src/theme/theme.css'))};
@source ${JSON.stringify(path.join(repository, 'packages/ui/src'))};
`;
}

const normalize = css => css.replace(/\s+/g, '');

/** Launches a Chromium instance owned by the calling test file. */
export function launchBrowser() {
  return chromium.launch({ headless: true });
}

/**
 * Drop-in replacement for `@tailwindcss/vite`. A stylesheet identical to
 * standardStyle() is served from the CSS compiled once in global-setup.js;
 * any other stylesheet goes through the real Tailwind plugin.
 */
export async function tailwind() {
  const { default: realTailwind } = await import(toolRequire.resolve('@tailwindcss/vite'));
  const cssFile = inject('tailwindCssFile');
  const standard = normalize(standardStyle());
  const served = new Set();
  const cached = {
    name: 'cossack-test:cached-tailwind',
    enforce: 'pre',
    async load(id) {
      const file = id.split('?')[0];
      if (!cssFile || !file.endsWith('.css') || file.includes('/node_modules/')) return null;
      let source;
      try { source = await fs.readFile(file, 'utf8'); } catch { return null; }
      if (normalize(source) !== standard) return null;
      served.add(file);
      return fs.readFile(cssFile, 'utf8');
    },
  };
  const skipServed = plugin => {
    const transform = plugin.transform;
    if (!transform) return plugin;
    const handler = typeof transform === 'function' ? transform : transform.handler;
    const wrapped = function (code, id, ...rest) {
      if (served.has(id.split('?')[0])) return null;
      return handler.call(this, code, id, ...rest);
    };
    return { ...plugin, transform: typeof transform === 'function' ? wrapped : { ...transform, handler: wrapped } };
  };
  return [cached, ...[realTailwind()].flat().map(skipServed)];
}
