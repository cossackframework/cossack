import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addFeature, createApp, renderRecipe, resolveRecipe } from '../src/index.js';
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
    // OAuth is added to email and password, never in their place: setup creates the first administrator with a password.
    expect(() => resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'], authMethods: 'oauth', oauth: 'github' })).toThrow(/always signs in with email and password/);
  });

  it('mounts the CMS from its package: the project holds its own configuration and no shell', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    // The application names the package it mounts; installing it alone adds no routes.
    const pkg = JSON.parse(text(files, 'package.json'));
    // The mount, and the recipe: a CMS project records no files, so its recipe is here (file-records.test.js).
    expect(pkg.cossack).toEqual({ runtime: 'node', packages: ['@cossackframework/cms'], features: ['cms'], template: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    // The sign-in pages, the dashboard, its kit, the services and auth are the package's: the project holds none.
    for (const rel of ['src/pages/auth/login/index.ts', 'src/pages/dashboard/layout.ts', 'src/pages/dashboard/users/index.ts', 'src/dashboard/list-table.ts', 'src/dashboard/registry.ts',
      'src/dashboard/modules/users.ts', 'src/dashboard/types.ts', 'src/auth.ts', 'src/auth-input.ts', 'src/brand.ts', 'src/services/users.ts', 'src/middlewares/auth.ts', 'src/config/auth.ts', 'src/lib/permissions.ts'])
      expect(files.has(rel), rel).toBe(false);
    expect([...files.keys()].filter(rel => rel.startsWith('src/')).sort()).toEqual([
      'src/App.ts', 'src/bootstrap/middlewares.ts', 'src/client/entry-client.ts', 'src/cms.config.ts', 'src/components/ui/index.ts', 'src/config/app.ts', 'src/config/cache.ts', 'src/config/cors.ts',
      'src/index.ts', 'src/root.ts', 'src/stores.client.ts', 'src/style.css', 'src/vite-env.d.ts',
    ]);
    // What the cms feature writes: the project's configuration and the update workflow.
    expect([...files].filter(([, entry]) => entry.capability === 'cms').map(([rel]) => rel).sort()).toEqual(['.github/workflows/cossack-update.yml', 'src/cms.config.ts']);
    expect(text(files, 'src/cms.config.ts')).toContain('export const options: CmsProjectConfig = {');
    expect(text(files, 'src/cms.config.ts')).toContain('export const modules = [contentModule, formsModule];');
    // The storage is the package's, named by runtime.
    expect(text(files, 'src/cms.config.ts')).toContain("import { nodeStorage } from '@cossackframework/cms/storage/node';");
    expect(text(files, 'src/cms.config.ts')).toContain('export const storage = nodeStorage;');
    expect([...files.keys()].filter(rel => rel.startsWith('src/pages/') || rel.startsWith('src/plugins/') || rel.startsWith('src/cms/') || rel.startsWith('src/dashboard/'))).toEqual([]);
    expect(files.has('src/pages/index.ts')).toBe(false);
    for (const rel of ['src/models/User.ts', 'src/models/Session.ts', 'src/models/Role.ts', 'src/migrations/0001_create_users.ts', 'src/lib/uuid.ts', 'orm.config.ts', 'src/seeders/application.seeder.ts'])
      expect(files.has(rel), rel).toBe(false);
    // The CMS's middleware is one list from the package; the project's own goes after it.
    const middlewares = text(files, 'src/bootstrap/middlewares.ts');
    expect(middlewares).toContain("import { cmsMiddlewares } from '@cossackframework/cms/app/cms/middlewares';");
    expect(middlewares).toContain('  ...cmsMiddlewares,');
    expect(middlewares).not.toContain('../auth');
    // The entry names the CMS's options and its background work; the package holds the code.
    expect(text(files, 'src/index.ts')).toContain("import { cmsAppOptions, startCmsMaintenance } from '@cossackframework/cms/app/cms/entry';");
    expect(text(files, 'src/index.ts')).toContain('  started: startCmsMaintenance,');
    expect(text(files, 'vite.config.ts')).not.toContain('@cossackframework/cms');
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
    // Applications with database auth keep passwords only, in their own modules.
    // Their shell is served from the dashboard package (dashboard-recipe.test.js); `servedFiles` shows it.
    const orm = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }), { servedFiles: true });
    expect(text(orm, 'src/auth.ts')).toContain('export const twoFactorAvailable = false;');
    expect(text(orm, 'src/passkeys.client.ts')).not.toContain('@simplewebauthn');
    expect(JSON.parse(text(orm, 'package.json')).cossack.packages).toEqual(['@cossackframework/dashboard']);
    expect(orm.has('src/pages/dashboard/index.ts')).toBe(true);
    expect(orm.has('src/dashboard/registry.ts')).toBe(true);
    expect(text(orm, 'src/bootstrap/middlewares.ts')).toContain('  ...authMiddlewares,');
  });

  it('keeps the served shell for the package\'s own application', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }), { servedFiles: true });
    for (const rel of ['src/pages/auth/login/index.ts', 'src/pages/dashboard/layout.ts', 'src/dashboard/list-table.ts', 'src/dashboard/registry.ts', 'src/middlewares/auth.ts', 'src/config/auth.ts'])
      expect(files.has(rel), rel).toBe(true);
  });

  it('renders the workflow that the dashboard\'s Update button starts', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    const workflow = text(files, '.github/workflows/cossack-update.yml');
    expect(files.get('.github/workflows/cossack-update.yml').capability).toBe('cms');
    // The site's request and a manual start both run it.
    expect(workflow).toContain('repository_dispatch:\n    types: [cossack-update]');
    expect(workflow).toContain('workflow_dispatch:');
    // The version comes from the request through the environment, and is checked before it is used.
    expect(workflow).toContain("VERSION: ${{ github.event.client_payload.version || inputs.version || 'latest' }}");
    expect(workflow.indexOf('Check the requested version')).toBeLessThan(workflow.indexOf('actions/checkout'));
    expect(workflow).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(workflow).toContain('pnpm exec cossack upgrade --tag "$VERSION" --json');
    // A pull request by default; a push only on request, without conflicts and with passing checks.
    expect(workflow).toContain("MODE: ${{ vars.COSSACK_UPDATE_MODE || 'pull-request' }}");
    expect(workflow).toContain('if [ "$MODE" = "push" ] && [ "$NEEDS_REVIEW" = "false" ] && [ "$CHECKS" = "success" ]; then');
    // It holds no deploy secret.
    expect(workflow).not.toMatch(/secrets\./);
    // A project without the CMS has no dashboard to press the button in.
    const plain = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['dashboard'] }));
    expect(plain.has('.github/workflows/cossack-update.yml')).toBe(false);
  });

  it('renders the same project files on every runtime, apart from the storage it names', async () => {
    const node = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    const worker = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const cms = files => [...files].filter(([, entry]) => entry.capability === 'cms').map(([rel]) => rel).sort();
    expect(cms(worker)).toEqual(cms(node));
    expect(text(worker, 'src/index.ts')).toContain("export { RomeDBPendingWrites, PluginBridge, PluginTail } from '@cossackframework/cms/app/cms/worker';");
    expect(text(worker, 'src/index.ts')).toContain('    cmsScheduled(env, ctx);');
    expect(text(worker, 'src/cms.config.ts')).toContain("import { cloudflareStorage } from '@cossackframework/cms/storage/cloudflare';");
    expect(text(worker, 'src/cms.config.ts')).toContain('export const storage = cloudflareStorage;');
    const afterStorage = source => source.slice(source.indexOf('export const resources'));
    expect(afterStorage(text(worker, 'src/cms.config.ts'))).toBe(afterStorage(text(node, 'src/cms.config.ts')));
  });

  it('binds the Images binding and runs maintenance every minute on Workers', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.images).toEqual({ binding: 'IMAGES' });
    expect(config.triggers.crons).toEqual(['* * * * *']);
    const dependencies = JSON.parse(text(files, 'package.json')).dependencies;
    expect(dependencies).not.toHaveProperty('sharp');
    // Workers reach RomeDB by URL, without the package that holds the native addon.
    expect(dependencies).not.toHaveProperty('@romedb/node');
  });

  it('binds R2 media on Workers', async () => {
    const files = await renderRecipe(resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'] }));
    const config = JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.r2_buckets).toEqual([expect.objectContaining({ binding: 'MEDIA' })]);
    expect(JSON.parse(text(files, 'package.json')).dependencies).not.toHaveProperty('@aws-sdk/client-s3');
  });

  it('starts a CMS project from the minimal preset and refuses the examples', async () => {
    // `cossack create my-site --features cms` names no preset: the full-stack one would add the
    // examples, whose home page and static blog replace the CMS's home page and sitemap.
    const recipe = resolveRecipe({ adapter: 'cloudflare', features: ['cms'] });
    expect(recipe.preset).toBe('minimal');
    expect(recipe.resolvedFeatures).not.toContain('examples');
    const files = await renderRecipe(recipe);
    expect([...files.keys()].filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(resolveRecipe({ adapter: 'node' }).preset).toBe('full-stack');
    expect(() => resolveRecipe({ adapter: 'node', preset: 'full-stack', features: ['cms'] })).toThrow(/cannot be combined with examples/);
    expect(() => resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms', 'examples'] })).toThrow(/cannot be combined with examples/);
  });

  it('lists the OAuth providers in src/cms.config.ts and serves their routes from the package', async () => {
    const recipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: ['cms'], authMethods: 'credentials,oauth', oauth: 'github,google' });
    const files = await renderRecipe(recipe, { authSecret: 'abcdefghijklmnopqrstuvwxyz123456' });
    expect(text(files, 'src/cms.config.ts')).toContain("    oauth: ['github', 'google'],");
    expect(text(files, '.dev.vars.example')).toContain('GOOGLE_CLIENT_ID=');
    expect(JSON.parse(text(files, 'wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')).secrets.required).toEqual(expect.arrayContaining(['OAUTH_SECRET', 'GITHUB_CLIENT_SECRET']));
    // The routes are the package's, like the sign-in page; the project has no OAuth code.
    expect(files.has('src/pages/auth/[provider]/callback.ts')).toBe(false);
    expect((await import('../src/cms-recipe.js')).isServedCmsPath('src/pages/auth/[provider]/callback.ts')).toBe(true);
    expect(text(files, 'src/index.ts')).not.toContain('oauth');
    // Without providers the option is a comment.
    const plain = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    expect(text(plain, 'src/cms.config.ts')).toContain("    // oauth: ['github'],");
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
    expect(both.has('src/auth.ts')).toBe(false);
    expect(text(both, 'src/bootstrap/middlewares.ts')).toContain('  ormRequestMiddleware,\n  ...cmsMiddlewares,');
  });

  it('refuses to add cms to a project whose users live in the database feature', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cms-recipe-'));
    directories.push(cwd);
    const { projectDir } = await createApp('orm-auth', { cwd, adapter: 'node', preset: 'auth', interactive: false });
    await expect(addFeature(projectDir, 'cms', { interactive: false })).rejects.toThrow(/keeps its users in the database feature/);
  });
  it('reads the recipe from the CMS application: what is served and rendered', async () => {
    const { isCmsPath, isServedCmsPath } = await import('../src/cms-recipe.js');
    const cmsAppDir = path.join(path.dirname(createRequire(import.meta.url).resolve('@cossackframework/cms/package.json')), 'app');
    const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
    // The scaffold ships a copy, so the CLI does not depend on the CMS package.
    const copy = JSON.parse(await fs.readFile(new URL('../src/cms-recipe.json', import.meta.url), 'utf8'));
    expect(copy, 'copy packages/cms/app/cossack-recipe.json to packages/scaffold/src/cms-recipe.json').toEqual(manifest);
    for (const rel of manifest.served) await expect(fs.access(path.join(cmsAppDir, rel)), rel).resolves.toBeUndefined();
    for (const rel of manifest.rendered) expect(isCmsPath(rel), rel).toBe(true);
    for (const rel of ['src/cms/site.ts', 'src/pages/dashboard/index.ts', 'src/pages/dashboard/layout.ts', 'src/pages/auth/login/index.ts', 'src/dashboard/list-table.ts', 'src/auth.ts'])
      expect(isServedCmsPath(rel), rel).toBe(true);
    // The project's own.
    for (const rel of ['src/cms.config.ts', 'src/stores.client.ts', 'src/App.ts', 'src/config/app.ts', 'src/bootstrap/middlewares.ts']) expect(isServedCmsPath(rel), rel).toBe(false);
    // Every file the package's application gets from the template and serves is one the project no longer holds.
    const held = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }), { servedFiles: true });
    const project = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['cms'] }));
    for (const rel of held.keys()) expect(project.has(rel), rel).toBe(!isServedCmsPath(rel));
    // Without the cms feature the shared modules are the application's own.
    const database = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'minimal', features: ['auth'] }), { servedFiles: true });
    expect(text(database, 'src/auth.ts')).not.toContain('@cossackframework/cms');
  });
});
