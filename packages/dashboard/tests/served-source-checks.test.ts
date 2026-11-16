// A project checks its own files only: the pages and components it mounts from this package
// are outside its template check. It runs here instead, over the package's application
// (after `pnpm sync`, as `pnpm test` does).
import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
// @ts-expect-error JavaScript modules of the CLI, without declarations.
import { checkProjectTemplates, formatTemplateDiagnostic } from '../../cossack/src/template-check.js';

const app = fileURLToPath(new URL('../app', import.meta.url));

it('the served pages and components have no template errors or warnings', () => {
  const { files, diagnostics } = checkProjectTemplates(app, { hints: false });
  expect(files).toBeGreaterThan(50);
  expect(diagnostics.map(formatTemplateDiagnostic)).toEqual([]);
}, 300_000);

