import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addFeature, createApp, renderRecipe, resolveRecipe, withClientDependencies } from '../src/index.js';
import { authStore } from '../src/registry.js';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
const text = (files, rel) => files.get(rel)?.content.toString();

describe('cms recipe', () => {
  it('brings auth and the dashboard on RomeDB without the ORM', () => {
    const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] });
    expect(recipe.resolvedFeatures).toEqual(['ui', 'auth', 'dashboard', 'cms']);
    expect(authStore(recipe.resolvedFeatures)).toBe('cms');
    expect(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['auth'] }).resolvedFeatures).toContain('database');
    expect(() => resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'], authMethods: 'credentials,oauth', oauth: 'github' })).toThrow(/OAuth sign-in is not available with the cms feature/);
  });

  it('renders the shared auth and dashboard pages over CMS storage', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    // Shared pages, storage modules from the CMS store, no ORM models or migrations.
    for (const rel of ['src/pages/auth/login/index.ts', 'src/pages/auth/register/index.ts', 'src/pages/dashboard/layout.ts', 'src/pages/dashboard/users/index.ts', 'src/pages/dashboard/sessions/index.ts'])
      expect(files.has(rel), rel).toBe(true);
    expect(text(files, 'src/auth.ts')).toContain("from './cms/index'");
    expect(text(files, 'src/services/users.ts')).toContain('currentCms().users');
    expect(text(files, 'src/dashboard/access.ts')).toContain("'/dashboard/collections'");
    expect(text(files, 'src/pages/dashboard/index.ts')).toContain('At a glance');
    for (const rel of ['src/models/User.ts', 'src/models/Session.ts', 'src/models/Role.ts', 'src/migrations/0001_create_users.ts', 'src/lib/uuid.ts', 'orm.config.ts', 'src/seeders/application.seeder.ts'])
      expect(files.has(rel), rel).toBe(false);
    // CMS screens under /dashboard, setup under /auth, the site at /.
    for (const rel of ['src/pages/dashboard/(cms)/content/[collection]/[id]/index.ts', 'src/pages/dashboard/(cms)/collections/[name]/index.ts', 'src/pages/dashboard/(cms)/media/index.ts',
      'src/pages/dashboard/(cms)/terms/[taxonomy]/index.ts', 'src/pages/dashboard/(cms)/field-groups/[id]/index.ts', 'src/pages/dashboard/(cms)/settings/[group]/index.ts', 'src/pages/auth/setup/index.ts', 'src/pages/(site)/index.ts',
      'src/pages/(site)/[...path]/index.ts', 'src/pages/(site)/media/[id]/[name]/index.ts', 'src/pages/api/auth/session.ts', 'src/cms/media.ts'])
      expect(files.has(rel), rel).toBe(true);
    expect(files.has('src/pages/index.ts')).toBe(false);
    expect([...files.keys()].some(rel => rel.startsWith('src/pages/cms/'))).toBe(false);
    // The host goes on the context before auth reads users from it.
    const middlewares = text(files, 'src/bootstrap/middlewares.ts');
    expect(middlewares.indexOf('cmsMiddleware,')).toBeLessThan(middlewares.indexOf('auth.middleware,'));
    expect(middlewares.indexOf('auth.middleware,')).toBeLessThan(middlewares.indexOf('cmsPrincipal,'));
    // The default theme is a plugin rendered as application source; the editor is TipTap, pinned.
    for (const rel of ['src/plugins/default-theme/plugin.json', 'src/plugins/default-theme/templates/layout.ts', 'src/plugins/default-theme/templates/entry.ts', 'src/plugins/default-theme/templates/archive.ts', 'src/plugins/default-theme/parts/comments.ts', 'src/cms/rich-text.client.ts', 'src/pages/dashboard/(cms)/appearance/menus/[id]/index.ts',
      'src/pages/api/cms/content/[collection]/index.ts', 'src/pages/api/cms/menus/[location].ts'])
      expect(files.has(rel), rel).toBe(true);
    expect(JSON.parse(text(files, 'src/plugins/default-theme/plugin.json')).theme.locations).toEqual({ primary: 'Primary menu', footer: 'Footer menu' });
    expect(JSON.parse(text(files, 'src/plugins/default-theme/plugin.json'))).toMatchObject({ logo: 'assets/logo.svg', cover: 'assets/cover.svg' });
    for (const rel of ['src/plugins/default-theme/assets/logo.svg', 'src/plugins/default-theme/assets/cover.svg', 'src/dashboard/avatar-field.ts']) expect(files.has(rel), rel).toBe(true);
    const pkg = JSON.parse(text(files, 'package.json'));
    expect(pkg.dependencies).toMatchObject({ '@cossackframework/cms': expect.any(String), '@cossackframework/auth': expect.any(String), '@aws-sdk/client-s3': expect.any(String),
      '@tiptap/core': '3.32.0', '@tiptap/starter-kit': '3.32.0', '@tiptap/pm': '3.32.0' });
    expect(pkg.dependencies).not.toHaveProperty('@cossackframework/database');
    expect(text(files, '.gitignore')).toContain('storage/media/');
    expect(text(files, 'src/cms/media.ts')).toContain('LocalStorageProvider');
  });

  it('renders the screens and routes of scheduling, SEO, redirects, webhooks, comments, languages and sign-in security', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    for (const rel of ['src/pages/(site)/preview/[collection]/[id]/index.ts', 'src/pages/(site)/sitemap.xml/index.ts', 'src/pages/(site)/sitemaps/[file]/index.ts', 'src/pages/(site)/robots.txt/index.ts',
      'src/pages/dashboard/(cms)/content/[collection]/[id]/revisions/index.ts', 'src/pages/dashboard/(cms)/tools/redirects/index.ts', 'src/pages/dashboard/(cms)/tools/webhooks/index.ts',
      'src/pages/dashboard/(cms)/comments/index.ts', 'src/pages/dashboard/(cms)/settings/languages/index.ts', 'src/pages/api/cms/comments/index.ts', 'src/pages/auth/two-factor/index.ts',
      'src/pages/dashboard/profile/security/index.ts', 'src/cms/seo.ts', 'src/cms/seo-head.ts', 'src/cms/sitemaps.ts'])
      expect(files.has(rel), rel).toBe(true);
    // The CMS store backs passkeys with SimpleWebAuthn; it resizes images with sharp on Node.
    expect(text(files, 'src/passkeys.client.ts')).toContain('@simplewebauthn/browser');
    expect(text(files, 'src/auth.ts')).toContain('export const twoFactorAvailable = true;');
    expect(text(files, 'src/cms/media.ts')).toContain("import('sharp')");
    expect(JSON.parse(text(files, 'package.json')).dependencies).toMatchObject({ sharp: expect.any(String), '@simplewebauthn/browser': '14.0.0', uqr: '0.1.3' });
    const config = text(files, 'vite.config.ts');
    expect(config.slice(config.indexOf('@cossack:client-dependencies'))).toContain("'@simplewebauthn/browser'");
    // Applications with database auth keep passwords only.
    const orm = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }));
    expect(text(orm, 'src/auth.ts')).toContain('export const twoFactorAvailable = false;');
    expect(text(orm, 'src/passkeys.client.ts')).not.toContain('@simplewebauthn');
    expect(JSON.parse(text(orm, 'package.json')).dependencies).not.toHaveProperty('@simplewebauthn/browser');
  });

  it('binds the Images binding and runs maintenance every minute on Workers', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.images).toEqual({ binding: 'IMAGES' });
    expect(config.triggers.crons).toEqual(['* * * * *']);
    expect(text(files, 'src/cms/media.ts')).toContain('env.IMAGES');
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty('sharp');
  });

  it('binds R2 media on Workers and keeps the examples home page', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms', 'examples'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.r2_buckets).toEqual([expect.objectContaining({ binding: 'MEDIA' })]);
    expect(text(files, 'src/cms/media.ts')).toContain('createR2StorageProvider');
    expect(files.has('src/pages/(public)/index.ts')).toBe(true);
    expect(files.has('src/pages/(site)/index.ts')).toBe(false);
    expect(files.has('src/pages/(site)/[...path]/index.ts')).toBe(true);
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty('@aws-sdk/client-s3');
  });

  it('lists the browser dependencies of rendered pages for the first Vite bundle', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    const config = text(files, 'vite.config.ts');
    const list = config.slice(config.indexOf('@cossack:client-dependencies'), config.indexOf('],', config.indexOf('@cossack:client-dependencies')));
    for (const name of ['@cossackframework/cms', '@cossackframework/framework/plugins', '@cossackframework/solar-icons/palette-2/line', '@tiptap/core', '@tiptap/starter-kit'])
      expect(list).toContain(`'${name}'`);
    expect(list).not.toContain('@cossackframework/cms/server');
    const source = (content) => ({ content: Buffer.from(content) });
    const synthetic = new Map([
      ['src/a.ts', source("import type { Tag } from '@cossackframework/solar-icons/tag/line';\nimport { Star } from '@cossackframework/solar-icons/star/line';\nconst editor = await import('@tiptap/core');")],
      ['src/b.ts', source("import { createCMS } from '@cossackframework/cms/server';\nimport { x } from 'left-pad';")],
    ]);
    expect(withClientDependencies("      // @cossack:client-dependencies\n      include: [],", synthetic))
      .toBe("      // @cossack:client-dependencies\n      include: [\n        '@cossackframework/solar-icons/star/line',\n        '@tiptap/core',\n      ],");
    expect(text(await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: [] })), 'vite.config.ts')).toContain('// @cossack:client-dependencies\n        include: [],');
  });

  it('leaves the default theme and the editor out of applications without cms', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }));
    expect([...files.keys()].some(rel => rel.startsWith('src/plugins/'))).toBe(false);
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty('@tiptap/core');
  });

  it('keeps the ORM application seeder only for ORM auth', async () => {
    const both = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms', 'database'] }));
    expect(text(both, 'src/seeders/application.seeder.ts')).toContain('Add application seed data here.');
    expect(text(both, 'src/models/index.ts')).not.toContain('User');
    expect(text(both, 'src/auth.ts')).toContain("from './cms/index'");
  });

  it('refuses to add cms to a project whose users live in the database feature', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-recipe-'));
    directories.push(cwd);
    const { projectDir } = await createApp('orm-auth', { cwd, adapter: 'node', preset: 'auth', interactive: false });
    await expect(addFeature(projectDir, 'cms', { interactive: false })).rejects.toThrow(/keeps its users in the database feature/);
  });
  it('reads the files it owns from the CMS application, and the template keeps none of them', async () => {
    const { cmsAppDir, isCmsPath } = await import('../src/cms-recipe.js');
    const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
    for (const rel of [...manifest.files, ...manifest.replaces]) await expect(fs.access(path.join(cmsAppDir, rel)), rel).resolves.toBeUndefined();
    for (const rel of manifest.rendered) expect(isCmsPath(rel)).toBe(true);
    const template = path.join(path.dirname(fileURLToPath(import.meta.url)), '../template');
    const walk = async (dir, prefix = '') => (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(entry =>
      entry.isDirectory() ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))).flat();
    expect((await walk(template)).filter(isCmsPath)).toEqual([]);
    // Shared modules the CMS store replaces come from the application only with the cms feature.
    const database = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['auth'] }));
    expect(text(database, 'src/auth.ts')).not.toContain("from './cms/index'");
  });
});
