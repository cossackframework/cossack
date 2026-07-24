import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addFeatureMock } = vi.hoisted(() => ({
  addFeatureMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  FEATURES: ['ui', 'database', 'auth', 'dashboard', 'examples'],
  addFeature: addFeatureMock,
  parseList: (value) => String(value).split(','),
}));

vi.mock('../src/templates.js', () => ({
  UI_COMPONENTS: {
    button: {
      className: 'Button',
      template: () => 'export class Button {}\n',
    },
  },
}));

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
      expect.stringContaining('Available components: button'),
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
});
