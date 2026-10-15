import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addFeatureMock } = vi.hoisted(() => ({
  addFeatureMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  FEATURES: ['ui', 'database', 'studio', 'auth', 'dashboard', 'markdown', 'examples'],
  addFeature: addFeatureMock,
  parseList: (value) => String(value).split(','),
}));

vi.mock('../src/templates.js', () => {
  const dialog = { path: 'internal/dialog.ts', content: 'export class DialogController {}\n' };
  return {
    UI_COMPONENTS: {
      button: { className: 'Button', template: () => 'export class Button {}\n', helpers: () => [] },
      modal: { className: 'Modal', template: () => "import './internal/dialog';\n", helpers: () => [dialog] },
      sheet: { className: 'Sheet', template: () => "import './internal/dialog';\n", helpers: () => [dialog] },
    },
  };
});

import { addCommand } from '../src/commands/add.js';

let root;

function context(overrides = {}) {
  return {
    cwd: root,
    flags: { yes: true },
    force: false,
    dryRun: false,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-add-test-'));
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app' }) + '\n',
  );
  addFeatureMock.mockResolvedValue({
    status: 'present',
    recipe: { resolvedFeatures: ['ui'] },
    changes: { writes: [], deletes: [] },
    addedFeatures: [],
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  addFeatureMock.mockReset();
  await fs.rm(root, { recursive: true, force: true });
});

describe('add command UI component ejection', () => {
  it('accepts Studio as a scaffold feature', async () => {
    expect(await addCommand(['studio'], context())).toBe(0);
    expect(addFeatureMock).toHaveBeenCalledWith(
      root,
      'studio',
      expect.objectContaining({ interactive: false }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ejects a documented UI component even when UI is already installed', async () => {
    expect(await addCommand(['ui', 'button'], context())).toBe(0);
    expect(await fs.readFile(
      path.join(root, 'src/components/ui/Button.ts'),
      'utf8',
    )).toBe('export class Button {}\n');
    expect(addFeatureMock).toHaveBeenCalledWith(
      root,
      'ui',
      expect.objectContaining({ interactive: false }),
    );
  });

  it('protects an existing ejected component unless forced', async () => {
    const target = path.join(root, 'src/components/ui/Button.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '// customized\n');

    expect(await addCommand(['ui', 'button'], context())).toBe(1);
    expect(await fs.readFile(target, 'utf8')).toBe('// customized\n');

    expect(await addCommand(
      ['ui', 'button'],
      context({ force: true }),
    )).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe('export class Button {}\n');
  });

  it('validates component names before changing the feature recipe', async () => {
    expect(await addCommand(['ui', 'missing'], context())).toBe(1);
    expect(addFeatureMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Available components: button, modal, sheet'),
    );
  });

  it('previews component ejection without writing during dry runs', async () => {
    addFeatureMock.mockResolvedValue({
      status: 'dry-run',
      recipe: { resolvedFeatures: ['ui'] },
      changes: { writes: [], deletes: [] },
      addedFeatures: ['ui'],
    });
    expect(await addCommand(
      ['ui', 'button'],
      context({ dryRun: true }),
    )).toBe(0);
    await expect(fs.access(
      path.join(root, 'src/components/ui/Button.ts'),
    )).rejects.toThrow();
  });

  it('copies a private helper once and shares it with later ejections', async () => {
    const helper = path.join(root, 'src/components/ui/internal/dialog.ts');
    expect(await addCommand(['ui', 'modal'], context())).toBe(0);
    expect(await fs.readFile(helper, 'utf8')).toBe('export class DialogController {}\n');
    await fs.writeFile(helper, '// customized\n');

    expect(await addCommand(['ui', 'sheet'], context())).toBe(0);
    expect(await fs.readFile(path.join(root, 'src/components/ui/Sheet.ts'), 'utf8')).toBe("import './internal/dialog';\n");
    expect(await fs.readFile(helper, 'utf8')).toBe('// customized\n');
    expect(console.error).not.toHaveBeenCalled();

    expect(await addCommand(['ui', 'sheet'], context({ force: true }))).toBe(0);
    expect(await fs.readFile(helper, 'utf8')).toBe('export class DialogController {}\n');
  });

  it('reports helper effects in JSON output and writes nothing during dry runs', async () => {
    const json = context({ flags: { yes: true, json: true } });
    expect(await addCommand(['ui', 'modal'], context({ dryRun: true }))).toBe(0);
    await expect(fs.access(path.join(root, 'src/components/ui/internal/dialog.ts'))).rejects.toThrow();
    vi.mocked(console.log).mockClear();
    expect(await addCommand(['ui', 'modal'], json)).toBe(0);
    expect(await addCommand(['ui', 'sheet'], json)).toBe(0);
    const reports = vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(line));
    expect(reports.map(report => report.data.effects.map(effect => effect.action))).toEqual([
      ['created', 'created'],
      ['created', 'preserved'],
    ]);
  });
});
