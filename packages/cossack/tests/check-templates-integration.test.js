import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkCommand } from '../src/commands/inspect.js';

const fixtures = fileURLToPath(new URL('../../renderer/tests/fixtures/templates', import.meta.url));
const rendererSource = fileURLToPath(new URL('../../renderer/src', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
const roots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

/** A copy of the renderer's template fixtures as a standalone project. */
async function project({ defects = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-check-templates-'));
  roots.push(root);
  await fs.cp(fixtures, root, { recursive: true });
  if (!defects) await fs.rm(path.join(root, 'defects'), { recursive: true });
  const config = JSON.parse(await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8'));
  config.compilerOptions.paths = {
    '@cossackframework/renderer': [path.join(rendererSource, 'index.ts')],
    '@cossackframework/renderer/*': [path.join(rendererSource, '*.ts')],
  };
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(config));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"templates","private":true}');
  return root;
}

it('reports each defect with file, line and column, and fails', async () => {
  const cwd = await project();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['templates'], { cwd, flags: {} })).toBe(1);
  const lines = errors.mock.calls.map(([line]) => line);
  expect(lines).toContain('defects/unknown-attribute.ts:5:11 - error COSSACK_TEMPLATE_UNKNOWN_ATTRIBUTE: <button> has no attribute "colour".');
  const defects = (await fs.readdir(path.join(cwd, 'defects'))).filter(file => file.endsWith('.ts'));
  for (const file of defects) expect(lines.some(line => new RegExp(`^defects/${file.replace('.', '\\.')}:\\d+:\\d+ - error `).test(line))).toBe(true);
  expect(output.mock.calls.at(-1)[0]).toMatch(new RegExp(`^Templates in \\d+ file\\(s\\): ${defects.length} error\\(s\\), 0 warning\\(s\\)\\.`));
});

it('emits one versioned JSON result', async () => {
  const cwd = await project();
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['templates'], { cwd, flags: { json: true } })).toBe(1);
  const result = JSON.parse(output.mock.calls[0][0]);
  expect(result).toMatchObject({ schemaVersion: 1, command: 'check', ok: false, data: { scope: 'templates', errors: 20, warnings: 0 } });
  expect(result.diagnostics).toContainEqual({
    code: 'COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT', severity: 'error', file: 'defects/self-closing-element.ts', line: 5, column: 3,
    source: 'defects/self-closing-element.ts:5:3', message: expect.stringContaining('<div /> does not close the element'),
  });
});

it('passes clean templates', async () => {
  const cwd = await project({ defects: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['templates'], { cwd, flags: {} })).toBe(0);
  expect(output.mock.calls.at(-1)[0]).toMatch(/0 error\(s\), 0 warning\(s\)\./);
});

it('lists hints as info in the JSON result of the CLI process with --verbose', async () => {
  const cwd = await project({ defects: false });
  await fs.writeFile(path.join(cwd, 'hint.ts'), `import { component, html } from '@cossackframework/renderer';
import { Card } from './components';

export const view = () => html\`<div>\${component(Card, { title: 'Card' })}</div>\`;
`);
  // The CLI runs --json commands in a child process and accepts only error, warning and info.
  const run = async (...flags) => JSON.parse((await promisify(execFile)(process.execPath, [cli, 'check', 'templates', '--json', ...flags], { cwd, timeout: 120_000 })).stdout);
  const quiet = await run();
  expect(quiet).toMatchObject({ command: 'check', ok: true, data: { scope: 'templates', errors: 0, warnings: 0, hints: 1 }, diagnostics: [] });
  const verbose = await run('--verbose');
  expect(verbose).toMatchObject({ ok: true, data: { hints: 1 } });
  expect(verbose.diagnostics).toEqual([expect.objectContaining({ code: 'COSSACK_TEMPLATE_COMPONENT_CALL', severity: 'info', file: 'hint.ts', line: 4 })]);
}, 240_000);
