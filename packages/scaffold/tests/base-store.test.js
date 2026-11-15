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

// The store holds the package text of `cossack eject` copies and of rendered plugins. A
// project's scaffold files have no stored text: their recipe renders them again.
describe('merge bases', () => {
  it('creates a project without a store, and keeps a later store out of diffs', async () => {
    const projectDir = await minimalProject();
    await expect(fs.access(path.join(projectDir, '.cossack'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readManifest(projectDir)).files).toBeUndefined();
    // When a store appears, it is committed with the project, and its diffs stay out of reviews.
    expect(await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8')).not.toContain('.cossack/base');
    expect(await fs.readFile(path.join(projectDir, '.gitattributes'), 'utf8')).toBe('.cossack/base/** -diff linguist-generated\n');
  });

  it('removes blobs that no manifest names, and keeps the rest', async () => {
    const projectDir = await minimalProject();
    const kept = await putBase(projectDir, 'the package text of an ejected page\n');
    const stray = await putBase(projectDir, 'nothing refers to this\n');
    await fs.writeFile(path.join(projectDir, '.cossack/scaffold.json'), JSON.stringify({ schemaVersion: 4, tool: '@cossackframework/scaffold',
      ejected: { 'src/pages/auth/login/index.ts': { package: '@acme/kit', path: 'pages/auth/login/index.ts', version: '1.0.0', base: kept, hash: sha256('x') } } }));
    expect(await pruneBases(projectDir)).toEqual([stray]);
    expect(await readBase(projectDir, stray)).toBeNull();
    expect(await readBase(projectDir, kept)).not.toBeNull();
    // A damaged blob is not a base.
    await fs.writeFile(path.join(projectDir, BASE_DIRECTORY, kept), 'tampered');
    expect(await readBase(projectDir, kept)).toBeNull();
    // Adding a feature keeps the ejected copy's record and its text, and stores nothing new.
    await fs.writeFile(path.join(projectDir, BASE_DIRECTORY, kept), 'the package text of an ejected page\n');
    await addFeature(projectDir, 'markdown', { interactive: false });
    expect(await fs.readdir(path.join(projectDir, BASE_DIRECTORY))).toEqual([kept]);
  });

  it('merges a local edit with a recipe change when a feature is added', async () => {
    const create = async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scaffold-base-'));
      temporaryDirectories.push(root);
      return (await createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false })).projectDir;
    };
    // The jobs feature adds a queue handler to the Worker entry.
    const reference = await create();
    await addFeature(reference, 'jobs', { interactive: false });
    const rel = 'src/index.ts';

    const projectDir = await create();
    const file = path.join(projectDir, rel);
    await fs.writeFile(file, '// A note the project added.\n' + await fs.readFile(file, 'utf8'));
    await addFeature(projectDir, 'jobs', { interactive: false });
    const upstream = await fs.readFile(path.join(reference, rel), 'utf8');
    expect(upstream).toContain('createJobs(env).queue(batch)');
    expect(await fs.readFile(file, 'utf8')).toBe('// A note the project added.\n' + upstream);
    // An edit the recipe did not touch stays as it is.
    await fs.appendFile(path.join(projectDir, '.gitignore'), 'notes/\n');
    await addFeature(projectDir, 'ui', { interactive: false });
    expect(await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8')).toContain('notes/');
  });
});
