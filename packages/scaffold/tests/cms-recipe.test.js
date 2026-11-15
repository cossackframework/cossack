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
    expect(recipe.resolvedFeatures).toEqual(['ui', 'auth', 'dashboard', 'markdown', 'cms']);
    expect(authStore(recipe.resolvedFeatures)).toBe('cms');
    expect(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['auth'] }).resolvedFeatures).toContain('database');
    expect(() => resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'], authMethods: 'credentials,oauth', oauth: 'github' })).toThrow(/OAuth sign-in is not available with the cms feature/);
  });

  it('mounts the CMS from its package: the project holds glue, re-exports and its own configuration', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    // The application names the package it mounts; installing it alone adds no routes.
    const pkg = JSON.parse(text(files, 'package.json'));
    expect(pkg.cossack).toEqual({ runtime: 'node', packages: ['@cossackframework/cms'] });
    // The shared shell stays in the project.
    for (const rel of ['src/pages/auth/login/index.ts', 'src/pages/auth/register/index.ts', 'src/pages/dashboard/layout.ts', 'src/pages/dashboard/users/index.ts', 'src/pages/dashboard/sessions/index.ts',
      'src/pages/auth/two-factor/index.ts', 'src/pages/dashboard/profile/security/index.ts', 'src/dashboard/avatar-field.ts', 'src/dashboard/list-table.ts'])
      expect(files.has(rel), rel).toBe(true);
    // What the cms feature writes: storage glue for the runtime, the project's configuration, and re-exports.
    expect([...files].filter(([, entry]) => entry.capability === 'cms').map(([rel]) => rel).sort()).toEqual([
      'src/auth.ts', 'src/brand.ts', 'src/cms.config.ts', 'src/cms/database.ts', 'src/cms/media.ts', 'src/cms/pending.ts',
      'src/dashboard/access.ts', 'src/dashboard/head.ts', 'src/dashboard/icons.ts', 'src/dashboard/user-sections.ts',
      'src/lib/permissions.ts', 'src/passkeys.client.ts', 'src/services/rbac.ts', 'src/services/roles.ts', 'src/services/users.ts',
    ]);
    // The shell imports these modules by relative path; each path re-exports the CMS's version, so there is one instance.
    expect(text(files, 'src/auth.ts')).toMatch(/^\/\/ .*\nexport \* from '@cossackframework\/cms\/app\/auth';\n$/);
    expect(text(files, 'src/services/users.ts')).toContain("export * from '@cossackframework/cms/app/services/users';");
    expect(text(files, 'src/dashboard/access.ts')).toContain("export * from '@cossackframework/cms/app/dashboard/access';");
    // A browser-only module names its exports: the server stubs it, and a stub cannot be made from export *.
    expect(text(files, 'src/passkeys.client.ts')).toContain("export { passkeysSupported, createPasskey, usePasskey } from '@cossackframework/cms/app/passkeys.client';");
    expect(text(files, 'src/cms.config.ts')).toContain('export const options: CmsProjectConfig = {');
    expect(text(files, 'src/cms.config.ts')).toContain('export const modules = [contentModule, formsModule];');
    // No served file: the CMS's pages, modules and default theme stay in the package, and the template's
    // dashboard home is left out so the package's is not overridden.
    const served = [...files.keys()].filter(rel => rel.startsWith('src/pages/dashboard/(cms)/') || rel.startsWith('src/pages/(site)/') || rel.startsWith('src/pages/api/') ||
      rel.startsWith('src/pages/auth/setup/') || rel.startsWith('src/plugins/') || rel.startsWith('src/config/cms') || rel === 'src/pages/dashboard/index.ts' ||
      (rel.startsWith('src/cms/') && !['src/cms/database.ts', 'src/cms/media.ts', 'src/cms/pending.ts'].includes(rel)));
    expect(served).toEqual([]);
    expect(files.has('src/pages/index.ts')).toBe(false);
    for (const rel of ['src/models/User.ts', 'src/models/Session.ts', 'src/models/Role.ts', 'src/migrations/0001_create_users.ts', 'src/lib/uuid.ts', 'orm.config.ts', 'src/seeders/application.seeder.ts'])
      expect(files.has(rel), rel).toBe(false);
    // The host goes on the context before auth reads users from it; the middleware is the package's.
    const middlewares = text(files, 'src/bootstrap/middlewares.ts');
    expect(middlewares).toContain("import { cmsMiddleware, cmsPrincipal } from '@cossackframework/cms/app/cms/middleware';");
    expect(middlewares.indexOf('cmsMiddleware,')).toBeLessThan(middlewares.indexOf('auth.middleware,'));
    expect(middlewares.indexOf('auth.middleware,')).toBeLessThan(middlewares.indexOf('cmsPrincipal,'));
    expect(text(files, 'src/index.ts')).toContain("import { networkFor } from '@cossackframework/cms/app/cms/index';");
    // Block styles come from the package, and Tailwind is told to scan the served files.
    expect(text(files, 'src/style.css')).toContain('@import "@cossackframework/cms/app/cms/blocks.css";');
    expect(text(files, 'src/style.css')).toContain('@source "../node_modules/@cossackframework/cms/app/src";');
    // The editor, passkey and QR code libraries are the package's dependencies, not the project's.
    expect(pkg.dependencies).toMatchObject({ '@cossackframework/cms': expect.any(String), '@cossackframework/auth': expect.any(String), '@aws-sdk/client-s3': expect.any(String), sharp: expect.any(String) });
    for (const name of ['@cossackframework/database', '@tiptap/core', '@simplewebauthn/browser', 'uqr']) expect(pkg.dependencies).not.toHaveProperty(name);
    // Different versions would install a second copy of RomeDB's value classes.
    expect(pkg.dependencies['@romedb/client']).toMatch(/^\d/);
    expect(pkg.dependencies['@romedb/client']).toBe(pkg.dependencies['@romedb/node']);
    expect(text(files, '.gitignore')).toContain('storage/media/');
    expect(text(files, 'src/cms/media.ts')).toContain('LocalStorageProvider');
    expect(text(files, 'src/cms/media.ts')).toContain("import('sharp')");
    const config = text(files, 'vite.config.ts');
    expect(config).toContain("external: ['@romedb/client', '@romedb/node']");
    // The icon sprites come from the CMS package's Vite plugin, not from files in the application.
    expect(config).toContain("import { cossackCmsIcons } from '@cossackframework/cms/vite';");
    expect(config).toContain('    cossackCmsIcons(),');
    // Applications with database auth keep passwords only, in their own modules.
    const orm = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }));
    expect(text(orm, 'src/auth.ts')).toContain('export const twoFactorAvailable = false;');
    expect(text(orm, 'src/passkeys.client.ts')).not.toContain('@simplewebauthn');
    expect(JSON.parse(text(orm, 'package.json')).cossack).toEqual({ runtime: 'node' });
    expect(orm.has('src/pages/dashboard/index.ts')).toBe(true);
  });

  it('renders the same project files on every runtime, apart from the storage glue', async () => {
    const node = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    const worker = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const cms = files => [...files].filter(([, entry]) => entry.capability === 'cms').map(([rel]) => rel).sort();
    expect(cms(worker)).toEqual(cms(node));
    expect(text(worker, 'src/index.ts')).toContain("import { networkFor, setPluginRunner } from '@cossackframework/cms/app/cms/index';");
    expect(text(worker, 'src/cms.config.ts')).toBe(text(node, 'src/cms.config.ts'));
    expect(text(worker, 'src/cms/database.ts')).not.toBe(text(node, 'src/cms/database.ts'));
  });

  it('binds the Images binding and runs maintenance every minute on Workers', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.images).toEqual({ binding: 'IMAGES' });
    expect(config.triggers.crons).toEqual(['* * * * *']);
    expect(text(files, 'src/cms/media.ts')).toContain('env.IMAGES');
    const dependencies = JSON.parse(text(files, 'package.json')).dependencies;
    expect(dependencies).not.toHaveProperty('sharp');
    // Workers reach RomeDB by URL, without the package that holds the native addon.
    expect(dependencies).not.toHaveProperty('@romedb/node');
  });

  it('binds R2 media on Workers and keeps the examples home page', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms', 'examples'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.r2_buckets).toEqual([expect.objectContaining({ binding: 'MEDIA' })]);
    expect(text(files, 'src/cms/media.ts')).toContain('createR2StorageProvider');
    expect(files.has('src/pages/(public)/index.ts')).toBe(true);
    // The package's home page gives way to the application's: an application page overrides a package page of the same URL.
    expect(files.has('src/pages/(site)/index.ts')).toBe(false);
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty('@aws-sdk/client-s3');
  });

  it('lists the browser dependencies of rendered pages for the first Vite bundle', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    const config = text(files, 'vite.config.ts');
    const list = config.slice(config.indexOf('@cossack:client-dependencies'), config.indexOf('],', config.indexOf('@cossack:client-dependencies')));
    for (const name of ['@cossackframework/cms', '@cossackframework/ui', '@cossackframework/solar-icons/users-group-rounded/line', 'hono/cookie'])
      expect(list).toContain(`'${name}'`);
    // The served files' imports are the framework's to add, from the mounted package.
    expect(list).not.toContain('@tiptap/core');
    expect(list).not.toContain('@cossackframework/cms/server');
    const source = (content) => ({ content: Buffer.from(content) });
    const synthetic = new Map([
      ['src/a.ts', source("import type { Tag } from '@cossackframework/solar-icons/tag/line';\nimport { Star } from '@cossackframework/solar-icons/star/line';\nconst editor = await import('@tiptap/core');")],
      ['src/b.ts', source("import { createCMS } from '@cossackframework/cms/server';\nimport { x } from 'left-pad';")],
    ]);
    expect(withClientDependencies("      // @cossack:client-dependencies\n      include: [],", synthetic))
      .toBe("      // @cossack:client-dependencies\n      include: [\n        '@cossackframework/solar-icons/star/line',\n        '@tiptap/core',\n      ],");
    // The Worker's list gets the icon subpaths and the editor's packages, never the framework's own (one copy of each).
    const both = new Map([...synthetic, ['src/c.ts', source("import { ui } from '@cossackframework/ui';\nimport { plugins } from '@cossackframework/framework/plugins';")]]);
    expect(withClientDependencies("      // @cossack:server-dependencies\n      ...([] as string[]),\n      '@cossackframework/renderer > parse5',", both))
      .toBe("      // @cossack:server-dependencies\n      '@cossackframework/solar-icons/star/line',\n      '@tiptap/core',\n      '@cossackframework/renderer > parse5',");
    expect(withClientDependencies("      // @cossack:server-dependencies\n      ...([] as string[]),\n      'x',", new Map())).toBe("      // @cossack:server-dependencies\n      'x',");
    const rendered = text(files, 'vite.config.ts');
    expect(rendered.slice(rendered.indexOf('@cossack:server-dependencies'), rendered.indexOf('parse5'))).toContain("'@cossackframework/solar-icons/users-group-rounded/line'");
    expect(rendered.slice(rendered.indexOf('@cossack:server-dependencies'), rendered.indexOf('parse5'))).not.toContain("'@cossackframework/ui'");
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
    expect(text(both, 'src/auth.ts')).toContain("export * from '@cossackframework/cms/app/auth';");
  });

  it('refuses to add cms to a project whose users live in the database feature', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-recipe-'));
    directories.push(cwd);
    const { projectDir } = await createApp('orm-auth', { cwd, adapter: 'node', preset: 'auth', interactive: false });
    await expect(addFeature(projectDir, 'cms', { interactive: false })).rejects.toThrow(/keeps its users in the database feature/);
  });
  it('reads the recipe from the CMS application: what is served, re-exported and rendered', async () => {
    const { cmsAppDir, isCmsPath, isServedCmsPath } = await import('../src/cms-recipe.js');
    const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
    for (const rel of [...manifest.served, ...manifest.facades]) await expect(fs.access(path.join(cmsAppDir, rel)), rel).resolves.toBeUndefined();
    for (const rel of [...manifest.rendered, ...manifest.facades]) expect(isCmsPath(rel), rel).toBe(true);
    expect(isServedCmsPath('src/cms/site.ts')).toBe(true);
    expect(isServedCmsPath('src/pages/dashboard/index.ts')).toBe(true);
    // The storage glue is under a served directory and is the project's.
    expect(isServedCmsPath('src/cms/database.ts')).toBe(false);
    expect(isServedCmsPath('src/pages/dashboard/layout.ts')).toBe(false);
    // Without the cms feature the shared modules are the application's own.
    const database = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['auth'] }));
    expect(text(database, 'src/auth.ts')).not.toContain('@cossackframework/cms');
  });
});
