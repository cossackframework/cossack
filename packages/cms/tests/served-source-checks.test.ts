// A project checks its own files only: the pages, components and plugins it mounts from this
// package are outside its template check and plugin policy lint. They run here instead, over
// the package's application (after `pnpm sync`, as `pnpm test` does).
import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
// @ts-expect-error JavaScript modules of the CLI, without declarations.
import { checkProjectTemplates, formatTemplateDiagnostic } from '../../cossack/src/template-check.js';
// @ts-expect-error JavaScript modules of the CLI, without declarations.
import { lintProjectPlugins, formatPolicyDiagnostic } from '../../cossack/src/plugin-policy.js';

const app = fileURLToPath(new URL('../app', import.meta.url));

it('the served pages and components have no template errors or warnings', () => {
  const { files, diagnostics } = checkProjectTemplates(app, { hints: false });
  expect(files).toBeGreaterThan(100);
  expect(diagnostics.map(formatTemplateDiagnostic)).toEqual([]);
}, 300_000);

it('the served plugins pass the plugin policy lint', async () => {
  const results = await lintProjectPlugins(app);
  expect(results.map((result: { plugin: string }) => result.plugin)).toContain('default-theme');
  expect(results.flatMap((result: { diagnostics: unknown[] }) => result.diagnostics).map(formatPolicyDiagnostic)).toEqual([]);
});
