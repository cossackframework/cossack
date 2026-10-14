import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addFeature, createApp, removeFeatureFromProject, renderRecipe, resolveRecipe } from '../src/index.js';

const temporaryDirectories = [];
async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-template-drift-'));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('template drift', () => {
  it('has no static wrangler.jsonc template; the generated config is the only source', async () => {
    await expect(fs.access(new URL('../template/wrangler.jsonc', import.meta.url))).rejects.toMatchObject({ code: 'ENOENT' });
    const cloudflare = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal' }));
    expect(cloudflare.get('wrangler.jsonc')).toMatchObject({ capability: 'base' });
    const node = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal' }));
    expect(node.has('wrangler.jsonc')).toBe(false);
  });

  it('gives Node apps the CORS variables their starter config reads', async () => {
    // Cloudflare apps rely on the starter config's defaults (CORS on, no extra origins).
    const rendered = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal' }));
    for (const file of ['.env', '.env.example']) {
      const content = rendered.get(file).content.toString();
      expect(content, file).toMatch(/^CORS_ENABLED=true$/m);
      expect(content, file).toMatch(/^CORS_ORIGINS=http:\/\/localhost:\d+$/m);
    }
  });

  it('owns .dev.vars.example as a base file because every Cloudflare recipe needs APP_SECRET', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal' }));
    const example = files.get('.dev.vars.example');
    expect(example.capability).toBe('base');
    expect(example.content.toString()).toContain('APP_SECRET=');
  });

  it('keeps .dev.vars.example when the database feature is removed', async () => {
    const root = await temporaryDirectory();
    const { projectDir } = await createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false });
    await addFeature(projectDir, 'database', { interactive: false });
    await removeFeatureFromProject(projectDir, 'database', { interactive: false, yes: true });
    expect(await fs.readFile(path.join(projectDir, '.dev.vars.example'), 'utf8')).toContain('APP_SECRET=');
  });

  it('injects DB_PATH into Node bindings only for the SQLite database recipe', async () => {
    const minimal = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal' }));
    expect(minimal.get('src/index.ts').content.toString()).not.toContain('DB_PATH');
    const sqlite = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: 'database', database: 'sqlite' }));
    expect(sqlite.get('src/index.ts').content.toString()).toContain("DB_PATH: variables.DB_PATH ?? './database.sqlite'");
    const postgres = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: 'database', database: 'postgres' }));
    expect(postgres.get('src/index.ts').content.toString()).not.toContain('DB_PATH');
  });

  it('lets the Desktop entry choose its bindings through createEnv, like the Node entry', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: 'desktop' }));
    const entry = files.get('src/desktop/index.ts').content.toString();
    expect(entry).toContain('export function createEnv(variables: Record<string, string | undefined> = process.env)');
    // desktop:dev calls createEnv with .env values; only production builds env eagerly.
    expect(entry).toContain('export const env: Record<string, unknown> = import.meta.env.DEV ? {} : createEnv();');
    expect(entry).not.toContain('export const env: Record<string, unknown> = { ...process.env };');
  });

  it('createApp reports a clear error when the target path is a file', async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, 'app'), 'not a directory');
    await expect(createApp('app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false }))
      .rejects.toMatchObject({ code: 'COSSACK_TARGET_NOT_DIRECTORY', message: expect.stringContaining('is not a directory') });
  });
});
