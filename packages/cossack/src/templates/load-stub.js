import { readFileSync } from 'node:fs';

const stubsUrl = new URL('../stubs/', import.meta.url);

/** Load a stub and substitute {{name}} placeholders. */
export function loadStub(name, vars = {}) {
  const raw = readFileSync(new URL(name, stubsUrl), 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
