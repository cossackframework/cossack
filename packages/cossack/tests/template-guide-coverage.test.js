import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript-api';
import { checkTemplates } from '@cossackframework/renderer/diagnostics';

// Renderer and UI guides teach templates: their examples must typecheck, pass
// the template check without hints (component tags, not component() with a
// literal class) and run.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = ['renderer', 'ui'];
let directory;
let examples;

async function publicEntry(specifier, condition) {
  const [, pkg, ...subpath] = specifier.split('/');
  const folder = path.join(root, 'packages', pkg);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const entry = manifest.exports?.[subpath.length ? './' + subpath.join('/') : '.'];
  return path.join(folder, typeof entry === 'string' ? entry : entry[condition]);
}
const importsOf = source => [...new Set([...source.matchAll(/from\s*['"](@cossackframework\/[^'"]+)['"]/g)].map(match => match[1]))];

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-template-guides-'));
  examples = [];
  for (const pkg of packages) {
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'packages', pkg, 'agent-docs.json'), 'utf8'));
    for (const guide of metadata.guides) for (const example of guide.examples) {
      examples.push({ name: `${pkg}/${guide.id}/${example.id}`, source: example.source, file: path.join(directory, `${pkg}--${guide.id}--${example.id}.ts`) });
    }
  }
  for (const example of examples) await fs.writeFile(example.file, example.source);
});
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('typechecks every renderer and UI example and passes the template check without hints', async () => {
  const paths = {};
  for (const example of examples) for (const specifier of importsOf(example.source)) paths[specifier] = [await publicEntry(specifier, 'types')];
  const program = ts.createProgram(examples.map(example => example.file), {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, types: ['node'], paths, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  });
  const files = new Set(examples.map(example => example.file));
  const typeErrors = ts.getPreEmitDiagnostics(program).filter(diagnostic => files.has(diagnostic.file?.fileName));
  expect(ts.formatDiagnostics(typeErrors, { getCanonicalFileName: file => file, getCurrentDirectory: () => directory, getNewLine: () => '\n' })).toBe('');
  const templateProblems = examples.flatMap(example => checkTemplates(ts, program, program.getSourceFile(example.file))
    .map(diagnostic => `${example.name}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.code}`));
  expect(templateProblems).toEqual([]);
}, 120_000);

it('runs every renderer and UI example', async () => {
  for (const example of examples) {
    let source = example.source;
    for (const specifier of importsOf(source)) source = source.split(`'${specifier}'`).join(JSON.stringify(pathToFileURL(await publicEntry(specifier, 'import')).href));
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const file = example.file.replace(/\.ts$/, '.mjs');
    await fs.writeFile(file, compiled);
    await expect(import(pathToFileURL(file).href), example.name).resolves.toBeDefined();
  }
}, 120_000);
