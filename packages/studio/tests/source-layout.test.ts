import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Studio source layout', () => {
  it('does not contain emitted JavaScript that can shadow TypeScript modules', async () => {
    const libDirectory = fileURLToPath(new URL('../src/lib/', import.meta.url));
    const emittedJavaScript = (await readdir(libDirectory))
      .filter((name) => name.endsWith('.js'))
      .sort();

    expect(emittedJavaScript).toEqual([]);
  });
});
