import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  _setPromptTestOverrides,
  createApp,
  PromptAbortedError,
  readManifest,
  switchAdapter,
} from '../src/index.js';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-adapter-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function create(adapter, preset = 'minimal', options = {}) {
  const cwd = await temporaryDirectory();
  return createApp('app', {
    cwd,
    adapter,
    preset,
    interactive: false,
    ...options,
  });
}

function promptSequence(input, responses) {
  const names = [];
  _setPromptTestOverrides({
    input,
    prompt: async (question, hooks) => {
      names.push(question.name);
      const response = responses.shift();
      if (response === 'escape') {
        input.emit('keypress', '', { name: 'escape' });
        hooks.onCancel();
        return {};
      }
      if (response === 'ctrl-c') {
        input.emit('keypress', '', { name: 'c', ctrl: true });
        hooks.onCancel();
        return {};
      }
      return { [question.name]: response };
    },
  });
  return names;
}

afterEach(async () => {
  _setPromptTestOverrides();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('adapter switching', () => {
  it.each(['minimal', 'orm', 'auth', 'full-stack'])(
    'matches direct Node creation for the %s recipe',
    async (preset) => {
      const source = await create('cloudflare', preset);
      const direct = await create('node', preset);
      const result = await switchAdapter(source.projectDir, 'node', {
        database: 'sqlite',
        interactive: false,
      });

      expect(result.status).toBe('changed');
      expect((await readManifest(source.projectDir)).files)
        .toEqual((await readManifest(direct.projectDir)).files);
    },
  );

  it.each(['minimal', 'orm', 'auth', 'full-stack'])(
    'matches direct Cloudflare creation for the %s recipe',
    async (preset) => {
      const source = await create('node', preset);
      const direct = await create('cloudflare', preset);
      const result = await switchAdapter(source.projectDir, 'cloudflare', {
        database: 'd1',
        interactive: false,
      });

      expect(result.status).toBe('changed');
      expect((await readManifest(source.projectDir)).files)
        .toEqual((await readManifest(direct.projectDir)).files);
    },
  );

  it('records the target default when database support is absent', async () => {
    const project = await create('cloudflare');
    const result = await switchAdapter(project.projectDir, 'node', {
      interactive: false,
    });
    expect(result.databaseChange).toEqual({
      previous: 'd1',
      target: 'sqlite',
      changed: true,
      installed: false,
    });
    expect((await readManifest(project.projectDir)).config.database).toBe('sqlite');
  });

  it('preserves Turso and requires an explicit replacement for incompatible providers', async () => {
    const turso = await create('cloudflare', 'orm', { database: 'turso' });
    expect((await switchAdapter(turso.projectDir, 'node', {
      interactive: false,
    })).databaseChange.target).toBe('turso');

    const d1 = await create('cloudflare', 'orm');
    await expect(switchAdapter(d1.projectDir, 'node', {
      interactive: false,
    })).rejects.toThrow('Pass --database=sqlite or --database=turso');
  });

  it('returns present for the active adapter without writing', async () => {
    const project = await create('node');
    const before = await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    );
    const result = await switchAdapter(project.projectDir, 'node', {
      database: 'turso',
      interactive: false,
    });
    expect(result.status).toBe('present');
    expect(await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    )).toBe(before);
  });

  it('keeps dry runs completely read-only', async () => {
    const project = await create('cloudflare', 'orm');
    const before = await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    );
    const result = await switchAdapter(project.projectDir, 'node', {
      database: 'sqlite',
      dryRun: true,
    });
    expect(result.status).toBe('dry-run');
    expect(result.changes.writes.length).toBeGreaterThan(0);
    expect(await fs.readFile(
      path.join(project.projectDir, '.cossack/scaffold.json'),
      'utf8',
    )).toBe(before);
    await expect(fs.access(path.join(project.projectDir, '.env'))).rejects.toThrow();
  });

  it('transfers recognized environment values with target precedence', async () => {
    const project = await create('cloudflare', 'auth', {
      database: 'turso',
      authMethods: 'oauth',
      oauth: 'github',
    });
    await fs.writeFile(
      path.join(project.projectDir, '.dev.vars'),
      'APP_URL=https://source.example\nGITHUB_CLIENT_ID=source-id\n' +
      'TURSO_URL=libsql://source\nSOURCE_ONLY=keep-at-source\n',
    );
    await fs.writeFile(
      path.join(project.projectDir, '.env'),
      'APP_URL=https://target.example\nCUSTOM_TARGET=value\n',
    );

    await switchAdapter(project.projectDir, 'node', {
      interactive: false,
    });
    const target = await fs.readFile(path.join(project.projectDir, '.env'), 'utf8');
    const source = await fs.readFile(path.join(project.projectDir, '.dev.vars'), 'utf8');
    expect(target).toContain('APP_URL=https://target.example');
    expect(target).toContain('GITHUB_CLIENT_ID=source-id');
    expect(target).toContain('TURSO_URL=libsql://source');
    expect(target).toContain('DB_CONNECTION=turso');
    expect(target).toContain('CUSTOM_TARGET=value');
    expect(target).not.toContain('SOURCE_ONLY=');
    expect(source).toContain('SOURCE_ONLY=keep-at-source');
    expect((await readManifest(project.projectDir)).files).not.toHaveProperty('.env');
  });

  it('targets force at runtime files while preserving application edits and migrations', async () => {
    const project = await create('cloudflare', 'orm');
    const runtime = path.join(project.projectDir, 'src/index.ts');
    const page = path.join(project.projectDir, 'src/pages/index.ts');
    const migration = path.join(
      project.projectDir,
      'src/migrations/0006_create_cache_table.ts',
    );
    await fs.appendFile(runtime, '\n// runtime edit\n');
    await fs.appendFile(page, '\n// application edit\n');
    await fs.appendFile(migration, '\n// migration edit\n');

    await expect(switchAdapter(project.projectDir, 'node', {
      database: 'sqlite',
      interactive: false,
    })).rejects.toThrow('Scaffold conflicts');
    const result = await switchAdapter(project.projectDir, 'node', {
      database: 'sqlite',
      interactive: false,
      force: true,
    });
    expect(result.status).toBe('changed');
    expect(await fs.readFile(runtime, 'utf8')).not.toContain('// runtime edit');
    expect(await fs.readFile(page, 'utf8')).toContain('// application edit');
    expect(await fs.readFile(migration, 'utf8')).toContain('// migration edit');
  });

  it('protects modified runtime package fields unless forced', async () => {
    const project = await create('cloudflare');
    const packagePath = path.join(project.projectDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    pkg.scripts.dev = 'custom-dev';
    pkg.scripts.custom = 'custom-script';
    pkg.dependencies['user-package'] = '^1.0.0';
    await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');

    await expect(switchAdapter(project.projectDir, 'node', {
      interactive: false,
    })).rejects.toThrow('package.json#scripts.dev');
    await switchAdapter(project.projectDir, 'node', {
      interactive: false,
      force: true,
    });
    const switched = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    expect(switched.scripts.dev).not.toBe('custom-dev');
    expect(switched.scripts.custom).toBe('custom-script');
    expect(switched.dependencies['user-package']).toBe('^1.0.0');
  });

  it('supports cancellation, Escape/back, and Ctrl+C', async () => {
    const cancelled = await create('cloudflare', 'orm');
    const input = new EventEmitter();
    let names = promptSequence(input, ['sqlite', false]);
    const result = await switchAdapter(cancelled.projectDir, 'node', {
      interactive: true,
    });
    expect(result.status).toBe('cancelled');
    expect(names).toEqual(['database', 'confirmed']);
    expect((await readManifest(cancelled.projectDir)).runtime).toBe('cloudflare');

    const back = await create('cloudflare', 'orm');
    names = promptSequence(input, ['sqlite', 'escape', 'turso', true]);
    const changed = await switchAdapter(back.projectDir, 'node', {
      interactive: true,
    });
    expect(changed.databaseChange.target).toBe('turso');
    expect(names).toEqual(['database', 'confirmed', 'database', 'confirmed']);

    const aborted = await create('cloudflare', 'orm');
    promptSequence(input, ['ctrl-c']);
    await expect(switchAdapter(aborted.projectDir, 'node', {
      interactive: true,
    })).rejects.toBeInstanceOf(PromptAbortedError);
    expect((await readManifest(aborted.projectDir)).runtime).toBe('cloudflare');
  });

  it('rejects invalid targets and projects without schema-v3 manifests', async () => {
    const project = await create('node');
    await expect(switchAdapter(project.projectDir, 'deno', {
      interactive: false,
    })).rejects.toThrow('Supported values: cloudflare, node');
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, 'package.json'), '{}\n');
    await expect(switchAdapter(root, 'node', {
      interactive: false,
    })).rejects.toThrow('requires a schema-v3');
  });
});
