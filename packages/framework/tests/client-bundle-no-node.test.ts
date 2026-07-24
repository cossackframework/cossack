// tests/client-bundle-no-node.test.ts
//
// Regression guard: the client entry (`src/client/app.ts`) must NOT import
// `config-globals` (or anything else that pulls in `node:async_hooks`).
//
// Background: `config`/`env`/`binding` read the request-scoped
// AsyncLocalStorage, which only exists in Node/Workers. Registering those
// globals on the client imported `node:async_hooks` into the browser bundle,
// which crashed hydration (browser bundles externalize/throw on node: imports).
// These globals are server-only; the client only needs `__`/`setLocale`/etc.
// from i18n-globals.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientEntry = readFileSync(join(__dirname, '../src/client/app.ts'), 'utf8');

describe('client entry must stay Node-free', () => {
    it('does not import config-globals (which transitively imports node:async_hooks)', () => {
        expect(clientEntry).not.toMatch(/['"]\.\.\/config-globals['"]/);
    });

    it('still imports i18n-globals (those are client-safe)', () => {
        expect(clientEntry).toMatch(/['"]\.\.\/i18n-globals(?:\.js)?['"]/);
    });
});
