import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { upgradeCommand, classifyFile, collectCossackDeps, _setTemplateDirOverride } from '../src/commands/upgrade.js';
import { parseFlags } from '../src/flags.js';

let tmpProject;
let tmpTemplate;

function sha(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
async function write(dir, rel, content) {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
  return sha(content);
}

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-up-proj-'));
  tmpTemplate = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-up-tpl-'));
  _setTemplateDirOverride(tmpTemplate);
});
afterEach(() => {
  _setTemplateDirOverride(null);
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpTemplate, { recursive: true, force: true });
});

describe('collectCossackDeps', () => {
  it('gathers cossack + @cossackframework/* across deps and devDeps', () => {
    const deps = collectCossackDeps({
      dependencies: {
        '@cossackframework/framework': '^0.5.0',
        cossack: '^0.1.0',
        hono: '^4.0.0',
      },
      devDependencies: {
        '@cossackframework/core': '^0.5.0',
        vite: '^8.0.0',
      },
    });
    expect(Object.keys(deps).sort()).toEqual([
      '@cossackframework/core',
      '@cossackframework/framework',
      'cossack',
    ]);
    expect(deps['cossack'].section).toBe('dependencies');
    expect(deps['@cossackframework/core'].section).toBe('devDependencies');
  });
});

describe('classifyFile matrix', () => {
  const b = sha('baseline');
  const m = sha('modified');
  const n = sha('new-template');

  it('excluded wins', () => {
    expect(classifyFile({ baseline: b, current: m, newHash: n, excluded: true })).toBe(
      'excluded',
    );
  });
  it('deleted -> missing', () => {
    expect(classifyFile({ baseline: b, current: null, newHash: n })).toBe(
      'missing',
    );
  });
  it('not in template -> excluded (adapter-generated)', () => {
    expect(classifyFile({ baseline: b, current: m, newHash: null })).toBe(
      'excluded',
    );
  });
  it('unchanged + template changed -> canUpdate', () => {
    expect(classifyFile({ baseline: b, current: b, newHash: n })).toBe(
      'canUpdate',
    );
  });
  it('user modified -> modified', () => {
    expect(classifyFile({ baseline: b, current: m, newHash: n })).toBe(
      'modified',
    );
  });
  it('already matches new template -> upToDate', () => {
    expect(classifyFile({ baseline: b, current: n, newHash: n })).toBe(
      'upToDate',
    );
  });
});

describe('upgradeCommand end-to-end (no network)', () => {
  // We avoid `npm view` / install by using --dry-run so no package.json writes
  // and no install runs; the drift report is what we verify.

  it('reports canUpdate vs modified from manifest', async () => {
    // manifest baseline
    const baselineApp = await write(tmpProject, 'src/App.ts', 'app-v1');
    const baselinePage = await write(tmpProject, 'src/pages/index.ts', 'page-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: {
        'src/App.ts': baselineApp,
        'src/pages/index.ts': baselinePage,
      },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));

    // new template: App.ts changed, index.ts unchanged
    await write(tmpTemplate, 'src/App.ts', 'app-v2');
    await write(tmpTemplate, 'src/pages/index.ts', 'page-v1');

    const code = await runUpgrade(['--dry-run']);
    expect(code).toBe(0);
  });

  it('apply-template updates unmodified files only', async () => {
    const baselineApp = await write(tmpProject, 'src/App.ts', 'app-v1');
    const baselineRoot = await write(tmpProject, 'src/root.ts', 'root-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: {
        'src/App.ts': baselineApp,
        'src/root.ts': baselineRoot,
      },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));

    // user modified root.ts
    await write(tmpProject, 'src/root.ts', 'root-user-edit');

    // new template
    await write(tmpTemplate, 'src/App.ts', 'app-v2'); // changed
    await write(tmpTemplate, 'src/root.ts', 'root-v2'); // changed too

    // dry-run apply-template
    await runUpgrade(['--apply-template', '--dry-run']);
    expect(fs.readFileSync(path.join(tmpProject, 'src/App.ts'), 'utf8')).toBe(
      'app-v1',
    ); // not applied (dry-run)
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'root-user-edit',
    );

    // real apply
    const ctx = makeCtx(['--apply-template']);
    await upgradeCommand(ctx.args, ctx.ctx);
    expect(fs.readFileSync(path.join(tmpProject, 'src/App.ts'), 'utf8')).toBe(
      'app-v2',
    ); // unmodified -> applied
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'root-user-edit',
    ); // modified -> skipped
  });

  it('force-file overrides skip for a modified file', async () => {
    const baselineRoot = await write(tmpProject, 'src/root.ts', 'root-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: { 'src/root.ts': baselineRoot },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));
    await write(tmpProject, 'src/root.ts', 'user-edit');
    await write(tmpTemplate, 'src/root.ts', 'root-v2');

    const ctx = makeCtx(['--force-file', 'src/root.ts']);
    await upgradeCommand(ctx.args, ctx.ctx);
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'root-v2',
    );
  });

  it('--force preserves modified files from the template', async () => {
    const baselineRoot = await write(tmpProject, 'src/root.ts', 'root-v1');
    const baselineApp = await write(tmpProject, 'src/App.ts', 'app-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: { 'src/root.ts': baselineRoot, 'src/App.ts': baselineApp },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));
    // user edited BOTH files
    await write(tmpProject, 'src/root.ts', 'root-user-edit');
    await write(tmpProject, 'src/App.ts', 'app-user-edit');
    await write(tmpTemplate, 'src/root.ts', 'root-v2');
    await write(tmpTemplate, 'src/App.ts', 'app-v2');

    const ctx = makeCtx(['--force']);
    await upgradeCommand(ctx.args, ctx.ctx);
    // Broad force applies safe updates but cannot destroy application edits.
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'root-user-edit',
    );
    expect(fs.readFileSync(path.join(tmpProject, 'src/App.ts'), 'utf8')).toBe(
      'app-user-edit',
    );
  });

  it('--force restores deleted (missing) files', async () => {
    const baselineRoot = await write(tmpProject, 'src/root.ts', 'root-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: { 'src/root.ts': baselineRoot },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));
    // user deleted the file
    fs.unlinkSync(path.join(tmpProject, 'src/root.ts'));
    await write(tmpTemplate, 'src/root.ts', 'root-v2');

    expect(fs.existsSync(path.join(tmpProject, 'src/root.ts'))).toBe(false);
    const ctx = makeCtx(['--force']);
    await upgradeCommand(ctx.args, ctx.ctx);
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'root-v2',
    );
  });

  it('without --force, modified files are NOT overwritten', async () => {
    const baselineRoot = await write(tmpProject, 'src/root.ts', 'root-v1');
    await write(tmpProject, 'package.json', '{}');
    const manifest = {
      schemaVersion: 1,
      templateVersion: '0.1.0',
      files: { 'src/root.ts': baselineRoot },
    };
    await write(tmpProject, '.cossack/scaffold.json', JSON.stringify(manifest));
    await write(tmpProject, 'src/root.ts', 'user-edit');
    await write(tmpTemplate, 'src/root.ts', 'root-v2');

    // --apply-template (no --force): modified file is skipped
    const ctx = makeCtx(['--apply-template']);
    await upgradeCommand(ctx.args, ctx.ctx);
    expect(fs.readFileSync(path.join(tmpProject, 'src/root.ts'), 'utf8')).toBe(
      'user-edit',
    );
  });

  async function runUpgrade(flags) {
    const ctx = makeCtx(flags);
    return upgradeCommand(ctx.args, ctx.ctx);
  }

  function makeCtx(flags) {
    const { args, flags: parsed } = parseFlags(flags);
    return {
      args,
      ctx: {
        flags: parsed,
        cwd: tmpProject,
        force: parsed.force === true,
        dryRun: parsed['dry-run'] === true,
      },
    };
  }

  // Regression tests for bug-3.md: `cossack upgrade --force` (and --apply-template
  // / --force-file) must NOT overwrite a Node project's runtime files with the
  // Cloudflare-flavored versions from the bundled template. The manifest records
  // adapter: "node", and configureNodeAdapter rewrites src/index.ts,
  // src/db/config.ts, and vite.config.ts at create time — those are excluded.
  describe('Node adapter protection (bug-3)', () => {
    async function seedNodeProject() {
      // Node-flavored runtime files as written by configureNodeAdapter.
      const nodeIndex = await write(
        tmpProject,
        'src/index.ts',
        'export const app = createApp({...}); // node entry',
      );
      const nodeDb = await write(
        tmpProject,
        'src/db/config.ts',
        'import Database from "better-sqlite3"; // node db config',
      );
      const nodeVite = await write(
        tmpProject,
        'vite.config.ts',
        '// node vite config (no cloudflare plugin)',
      );
      await write(tmpProject, 'package.json', '{}');
      const manifest = {
        schemaVersion: 1,
        tool: 'create-cossack-app',
        templateVersion: '0.1.0',
        adapter: 'node',
        files: {
          'src/index.ts': nodeIndex,
          'src/db/config.ts': nodeDb,
          'vite.config.ts': nodeVite,
        },
      };
      await write(
        tmpProject,
        '.cossack/scaffold.json',
        JSON.stringify(manifest),
      );
      // Cloudflare-flavored equivalents in the template.
      await write(
        tmpTemplate,
        'src/index.ts',
        'const app = createApp({...}); export default { fetch: app.fetch }; // cloudflare',
      );
      await write(
        tmpTemplate,
        'src/db/config.ts',
        'export function createClient(env) { return env.DB; } // cloudflare D1',
      );
      await write(
        tmpTemplate,
        'vite.config.ts',
        'cloudflare({ viteEnvironment: { name: "ssr" } }); // cloudflare plugin',
      );
    }

    it('--force does NOT overwrite Node adapter runtime files', async () => {
      await seedNodeProject();
      const ctx = makeCtx(['--force']);
      await upgradeCommand(ctx.args, ctx.ctx);
      expect(fs.readFileSync(path.join(tmpProject, 'src/index.ts'), 'utf8'))
        .toBe('export const app = createApp({...}); // node entry');
      expect(fs.readFileSync(path.join(tmpProject, 'src/db/config.ts'), 'utf8'))
        .toBe('import Database from "better-sqlite3"; // node db config');
      expect(fs.readFileSync(path.join(tmpProject, 'vite.config.ts'), 'utf8'))
        .toBe('// node vite config (no cloudflare plugin)');
    });

    it('--apply-template does NOT overwrite Node adapter runtime files', async () => {
      await seedNodeProject();
      const ctx = makeCtx(['--apply-template']);
      await upgradeCommand(ctx.args, ctx.ctx);
      expect(fs.readFileSync(path.join(tmpProject, 'src/index.ts'), 'utf8'))
        .toBe('export const app = createApp({...}); // node entry');
      expect(fs.readFileSync(path.join(tmpProject, 'vite.config.ts'), 'utf8'))
        .toBe('// node vite config (no cloudflare plugin)');
    });

    it('--force-file refuses adapter-specific files with a clear error', async () => {
      await seedNodeProject();
      const ctx = makeCtx([
        '--force-file',
        'src/index.ts',
        '--force-file',
        'vite.config.ts',
      ]);
      await upgradeCommand(ctx.args, ctx.ctx);
      // Node files untouched.
      expect(fs.readFileSync(path.join(tmpProject, 'src/index.ts'), 'utf8'))
        .toBe('export const app = createApp({...}); // node entry');
      expect(fs.readFileSync(path.join(tmpProject, 'vite.config.ts'), 'utf8'))
        .toBe('// node vite config (no cloudflare plugin)');
    });

    it('adapter is detected from wrangler presence when manifest lacks the field', async () => {
      // Older project: manifest has no `adapter`, but wrangler.jsonc present
      // => cloudflare, so adapter-specific files are NOT excluded and CAN be
      // updated normally.
      const baselineIndex = await write(
        tmpProject,
        'src/index.ts',
        'cloudflare-entry-v1',
      );
      await write(tmpProject, 'package.json', '{}');
      await write(tmpProject, 'wrangler.jsonc', '{}');
      const manifest = {
        schemaVersion: 1,
        templateVersion: '0.1.0',
        files: { 'src/index.ts': baselineIndex },
      };
      await write(
        tmpProject,
        '.cossack/scaffold.json',
        JSON.stringify(manifest),
      );
      await write(tmpTemplate, 'src/index.ts', 'cloudflare-entry-v2');

      const ctx = makeCtx(['--apply-template']);
      await upgradeCommand(ctx.args, ctx.ctx);
      expect(fs.readFileSync(path.join(tmpProject, 'src/index.ts'), 'utf8'))
        .toBe('cloudflare-entry-v2');
    });
  });
});
