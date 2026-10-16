import { afterEach, expect, it } from 'vitest';
import { build } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cossackPages } from '@cossackframework/framework/vite-plugin';

const packages = path.resolve(import.meta.dirname, '../..');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

/** A project with the CLI and renderer installed and one page. */
async function project(page: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-template-build-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'node_modules/@cossackframework'), { recursive: true });
  await fs.symlink(path.join(packages, 'cossack'), path.join(root, 'node_modules/cossack'), 'junction');
  await fs.symlink(path.join(packages, 'renderer'), path.join(root, 'node_modules/@cossackframework/renderer'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"template-build","private":true,"type":"module"}');
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true,
    lib: ['ESNext', 'DOM', 'DOM.Iterable'] }, include: ['src/**/*.ts'] }));
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/index.ts'), page);
  await fs.writeFile(path.join(root, 'entry.js'), 'export const entry = true;');
  return root;
}

const buildProject = (root: string, templateDiagnostics?: boolean) => build({
  root, configFile: false, logLevel: 'silent', plugins: [cossackPages({ templateDiagnostics })],
  build: { write: false, minify: false, lib: { entry: path.join(root, 'entry.js'), formats: ['es'] } },
});

it('fails the build with the file, line and column of each template error', async () => {
  const root = await project(`import { html } from '@cossackframework/renderer';
export const view = (label: string) => html\`
  <button type="sumbit" ?disabled=\${label}>Save</button>\`;
`);
  await expect(buildProject(root)).rejects.toMatchObject({
    message: expect.stringMatching(/src\/pages\/index\.ts:3:11 - error COSSACK_TEMPLATE_ATTRIBUTE_TYPE[^]*src\/pages\/index\.ts:3:37 - error COSSACK_TEMPLATE_BOOLEAN_BINDING/),
  });
}, 120_000);

it('builds clean templates, and skips checks when disabled', async () => {
  const clean = await project(`import { html } from '@cossackframework/renderer';
export const view = (label: string) => html\`<button type="submit" title=\${label}>Save</button>\`;
`);
  await expect(buildProject(clean)).resolves.toBeDefined();
  const broken = await project(`import { html } from '@cossackframework/renderer';
export const view = () => html\`<div />\`;
`);
  await expect(buildProject(broken, false)).resolves.toBeDefined();
}, 120_000);

it('reports development diagnostics as files change, and when they clear', async () => {
  const { startDevelopmentTemplateChecks } = await import('../src/vite-template-diagnostics.ts');
  const root = await project(`import { html } from '@cossackframework/renderer';
export const view = () => html\`<div colour="red"></div>\`;
`);
  const reports: { file: string; codes: string[] }[] = [];
  let notify: () => void = () => {};
  const next = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no template report')), 60_000);
    notify = () => { clearTimeout(timer); resolve(); };
  });
  const warnings: string[] = [];
  let report = next();
  const checks = startDevelopmentTemplateChecks(root, (file, diagnostics) => {
    reports.push({ file, codes: diagnostics.map(diagnostic => `${diagnostic.source} ${diagnostic.code}`) });
    notify();
  }, message => warnings.push(message))!;
  try {
    await report;
    expect(reports).toEqual([{ file: 'src/pages/index.ts', codes: ['src/pages/index.ts:2:37 COSSACK_TEMPLATE_UNKNOWN_ATTRIBUTE'] }]);
    report = next();
    await fs.writeFile(path.join(root, 'src/pages/index.ts'), `import { html } from '@cossackframework/renderer';
export const view = () => html\`<div class="red"></div>\`;
`);
    checks.changed([path.join(root, 'src/pages/index.ts')]);
    await report;
    expect(reports.at(-1)).toEqual({ file: 'src/pages/index.ts', codes: [] });
    expect(warnings).toEqual([]);
  } finally {
    checks.close();
  }
}, 120_000);

it('fails the build on a wrong component prop and on a mismatched closing tag', async () => {
  const component = `import { CossackElement, html } from '@cossackframework/renderer';
export class Card extends CossackElement {
  declare props: { padding?: 'sm' | 'lg' };
  render() { return html\`<div>\${this.children}</div>\`; }
}
export class Note extends Card {}
`;
  const wrongProp = await project(`import { html } from '@cossackframework/renderer';
import { Card } from './card';
export const view = () => html\`<\${Card} padding="huge">Body</\${Card}>\`;
`);
  await fs.writeFile(path.join(wrongProp, 'src/pages/card.ts'), component);
  await expect(buildProject(wrongProp)).rejects.toMatchObject({
    message: expect.stringMatching(/src\/pages\/index\.ts:3:41 - error COSSACK_TEMPLATE_PROP_TYPE: The padding prop of Card takes "sm" \| "lg", not "huge"\./),
  });
  const mismatched = await project(`import { html } from '@cossackframework/renderer';
import { Card, Note } from './card';
export const view = () => html\`<\${Card}>Body</\${Note}>\`;
`);
  await fs.writeFile(path.join(mismatched, 'src/pages/card.ts'), component);
  await expect(buildProject(mismatched)).rejects.toMatchObject({
    message: expect.stringMatching(/src\/pages\/index\.ts:3:49 - error COSSACK_TEMPLATE_COMPONENT_CLOSE_MISMATCH/),
  });
}, 120_000);
