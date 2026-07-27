import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const browserEventGlobals = [
  'KeyboardEvent',
  'MouseEvent',
  'PointerEvent',
  'InputEvent',
  'SubmitEvent',
  'FocusEvent',
] as const;

async function importFresh(relativePath: string) {
  const url = pathToFileURL(path.join(frameworkRoot, 'dist', 'esm', relativePath));
  url.searchParams.set('ssr-import-test', String(Date.now()));
  return import(url.href);
}

describe('SSR import safety', () => {
  it('imports the precompiled root runtime without browser event globals', async () => {
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    for (const name of browserEventGlobals) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Reflect.deleteProperty(globalThis, name);
    }

    try {
      await expect(importFresh('root.js')).resolves.toBeDefined();

      for (const name of browserEventGlobals) {
        expect(name in globalThis).toBe(false);
      }
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
});
