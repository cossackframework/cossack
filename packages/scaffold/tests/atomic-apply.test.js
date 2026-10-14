import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addFeature, createApp, removeFeatureFromProject } from '../src/index.js';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-scaffold-atomic-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

/** Every file below `root` with its bytes, keyed by relative path. */
async function snapshot(root) {
  const files = {};
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files[path.relative(root, absolute)] = (await fs.readFile(absolute)).toString('base64');
    }
  }
  await walk(root);
  return files;
}

/** Fail one write of a project file, after `skip` writes succeed. */
function failWriteAfter(projectDir, skip) {
  const original = fs.writeFile;
  let writes = 0;
  return vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...rest) => {
    if (String(file).startsWith(projectDir) && ++writes === skip + 1) throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
    return original.call(fs, file, ...rest);
  });
}

/** Fail only the manifest write, after every plan file has been written. */
function failManifestWrite() {
  const original = fs.writeFile;
  return vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...rest) => {
    if (/[\\/]\.cossack[\\/]\.scaffold\.json\..*\.tmp$/.test(String(file))) throw Object.assign(new Error('injected manifest failure'), { code: 'EIO' });
    return original.call(fs, file, ...rest);
  });
}

async function minimalProject() {
  const root = await temporaryDirectory();
  return (await createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false })).projectDir;
}

describe('plan application is atomic', () => {
  it.each([
    ['a mid-plan write', projectDir => failWriteAfter(projectDir, 2)],
    ['the manifest write', () => failManifestWrite()],
  ])('addFeature restores files and manifest when %s fails', async (_label, inject) => {
    const projectDir = await minimalProject();
    const before = await snapshot(projectDir);
    inject(projectDir);
    await expect(addFeature(projectDir, 'markdown', { interactive: false })).rejects.toThrow(/injected/);
    vi.restoreAllMocks();
    expect(await snapshot(projectDir)).toEqual(before);
  });

  it.each([
    ['a mid-plan write', projectDir => failWriteAfter(projectDir, 1)],
    ['the manifest write', () => failManifestWrite()],
  ])('removeFeatureFromProject restores files and manifest when %s fails', async (_label, inject) => {
    const projectDir = await minimalProject();
    await addFeature(projectDir, 'markdown', { interactive: false });
    const before = await snapshot(projectDir);
    inject(projectDir);
    await expect(removeFeatureFromProject(projectDir, 'markdown', { interactive: false, yes: true })).rejects.toThrow(/injected/);
    vi.restoreAllMocks();
    expect(await snapshot(projectDir)).toEqual(before);
  });

  it.each([
    ['a mid-plan write', projectDir => failWriteAfter(projectDir, 5)],
    ['the manifest write', () => failManifestWrite()],
  ])('createApp leaves no partial project when %s fails', async (_label, inject) => {
    const root = await temporaryDirectory();
    const projectDir = path.join(root, 'app');
    inject(projectDir);
    await expect(createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false })).rejects.toThrow(/injected/);
    vi.restoreAllMocks();
    await expect(fs.access(projectDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('createApp keeps a pre-existing empty target directory', async () => {
    const root = await temporaryDirectory();
    const projectDir = path.join(root, 'app');
    await fs.mkdir(projectDir);
    failManifestWrite();
    await expect(createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false })).rejects.toThrow(/injected/);
    vi.restoreAllMocks();
    expect(await fs.readdir(projectDir)).toEqual([]);
  });
});
