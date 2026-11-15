import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BASE_DIRECTORY, addFeature, createApp, pruneBases, putBase, readBase, readManifest } from '../src/index.js';

const temporaryDirectories = [];
const sha256 = content => createHash('sha256').update(content).digest('hex');

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function minimalProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scaffold-base-'));
  temporaryDirectories.push(root);
  return (await createApp('app', { cwd: root, adapter: 'node', preset: 'minimal', interactive: false })).projectDir;
}

describe('merge bases', () => {
  it('records the upstream text of every owned file in a committed store', async () => {
    const projectDir = await minimalProject();
    const manifest = await readManifest(projectDir);
    expect(manifest.schemaVersion).toBe(4);
    for (const [rel, entry] of Object.entries(manifest.files)) {
      if (rel === 'package.json' || rel === 'pnpm-workspace.yaml') {
        expect(entry.base).toBeUndefined();
        continue;
      }
      expect(entry.base, rel).toBe(entry.hash);
      expect(sha256(await readBase(projectDir, entry.base)), rel).toBe(sha256(await fs.readFile(path.join(projectDir, rel))));
    }
    // The store is committed with the project, and its diffs stay out of reviews.
    expect(await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8')).not.toContain('.cossack/base');
    expect(await fs.readFile(path.join(projectDir, '.gitattributes'), 'utf8')).toBe('.cossack/base/** -diff linguist-generated\n');
  });

  it('removes blobs that no manifest names, and keeps the rest', async () => {
    const projectDir = await minimalProject();
    const stray = await putBase(projectDir, 'nothing refers to this\n');
    const kept = (await readManifest(projectDir)).files['vite.config.ts'].base;
    expect(await pruneBases(projectDir)).toEqual([stray]);
    expect(await readBase(projectDir, stray)).toBeNull();
    expect(await readBase(projectDir, kept)).not.toBeNull();
    // A damaged blob is not a base.
    await fs.writeFile(path.join(projectDir, BASE_DIRECTORY, kept), 'tampered');
    expect(await readBase(projectDir, kept)).toBeNull();
  });

  it('merges a local edit with a recipe change when a feature is added', async () => {
    const reference = await minimalProject();
    const before = await readManifest(reference);
    await addFeature(reference, 'markdown', { interactive: false });
    const after = await readManifest(reference);
    const changed = Object.keys(after.files).filter(rel => before.files[rel]?.base && after.files[rel].base !== before.files[rel].base);
    expect(changed.length).toBeGreaterThan(0);
    const rel = changed[0];

    const projectDir = await minimalProject();
    const file = path.join(projectDir, rel);
    await fs.writeFile(file, await fs.readFile(file, 'utf8') + '// A note the project added.\n');
    await addFeature(projectDir, 'markdown', { interactive: false });
    const merged = await fs.readFile(file, 'utf8');
    const upstream = await fs.readFile(path.join(reference, rel), 'utf8');
    expect(merged).toBe(upstream + '// A note the project added.\n');
    const entry = (await readManifest(projectDir)).files[rel];
    // The file on disk is the merge; its base is the recipe's new text.
    expect(entry.hash).toBe(sha256(merged));
    expect(entry.base).toBe(sha256(upstream));
    expect((await readBase(projectDir, entry.base)).toString()).toBe(upstream);
  });

  it('keeps the base of an edit that the recipe did not touch', async () => {
    const projectDir = await minimalProject();
    const before = (await readManifest(projectDir)).files['.gitignore'];
    await fs.appendFile(path.join(projectDir, '.gitignore'), 'notes/\n');
    await addFeature(projectDir, 'markdown', { interactive: false });
    const entry = (await readManifest(projectDir)).files['.gitignore'];
    expect(entry.base).toBe(before.base);
    expect(await readBase(projectDir, entry.base)).not.toBeNull();
    expect(await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8')).toContain('notes/');
  });
});
