import { describe, expect, it } from 'vitest';
import { parseSync } from 'vite';
import { EXTENSION_POINT_EXPORTS, lintPlugin } from '../src/plugin-policy.js';

const manifest = {
  schemaVersion: 1, name: 'support-desk', version: '1.0.0',
  resources: [{ name: 'tickets', fields: { subject: { kind: 'string' } }, access: { update: { permission: 'support-desk/tickets:update' } } }],
  hooks: [{ point: 'cms.resource.before-write', version: 1 }],
  permissions: { resources: { 'cms/posts': ['read'] }, network: ['api.example.com'], define: ['support-desk:triage'] },
  commands: [{ name: 'close', description: 'Close tickets.', permission: 'support-desk:triage' }],
};
const lint = (source, override = {}) => lintPlugin({ manifest: { ...manifest, ...override }, files: [{ path: 'src/plugins/support-desk/server.ts', source }], parse: parseSync });
const codes = (source, override = {}) => lint(source, override).map(diagnostic => diagnostic.code);

describe('plugin policy', () => {
  it('accepts a plugin that stays within its manifest', () => {
    expect(lint(`
      import { beforeWrite, hasPermission, type PluginContext } from '@cossackframework/cms';
      import type { CmsHost } from '@cossackframework/cms/server';
      import { RecordId } from '@cossackframework/romedb/values';
      export function register(context: PluginContext) {
        context.hooks.addFilter(beforeWrite, draft => draft);
        context.commands.add('close', async (_input, { principal }) => {
          if (!hasPermission(principal, 'support-desk:triage')) return 0;
          await context.fetch(\`https://api.example.com/tickets/\${1}\`);
          return (await context.cms.resource('cms/posts').list({}, { principal })).records.length;
        });
      }
      export const label = 'Select a ticket from the list';
      fetch('/api/support/tickets');
    `)).toEqual([]);
  });

  it('lets an unrestricted plugin past every lint but parsing, with a warning', () => {
    const permissions = { unrestricted: true };
    const source = `
      import { createRomeDB } from '@cossackframework/romedb';
      import { createCMS } from '@cossackframework/cms/server';
      import net from 'node:net';
      export async function register(context: any) {
        const { db } = await context.unrestricted();
        await db.read([{ rql: 'SELECT * FROM cms_users' }]);
        await fetch('https://anywhere.example/collect');
        return [process.env.ROMEDB_TOKEN, context.files, context.hasPermission];
      }
    `;
    expect(lint(source, { permissions })).toMatchObject([{ code: 'COSSACK_PLUGIN_UNRESTRICTED', severity: 'warning', plugin: 'support-desk' }]);
    expect(codes(source)).toContain('COSSACK_PLUGIN_RAW_QUERY');
    expect(codes('export const broken = ;', { permissions })).toContain('COSSACK_PLUGIN_PARSE');
  });

  it('refuses context.unrestricted without the permission', () => {
    expect(codes(`export async function register(context) { await context.unrestricted(); }`)).toEqual(['COSSACK_PLUGIN_PERMISSION']);
  });

  it('rejects raw RomeQL, the RomeDB client and host internals', () => {
    const diagnostics = lint(`
      import { createRomeDB } from '@cossackframework/romedb';
      import { createCMS } from '@cossackframework/cms/server';
      export async function register(context: any) {
        await context.cms.db.read([{ rql: 'x' }]);
        const query = 'SELECT * FROM r__cms__posts WHERE id = 1';
        const other = \`DELETE FROM cms_users WHERE id = \${context.id}\`;
      }
    `);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(Array(5).fill('COSSACK_PLUGIN_RAW_QUERY'));
    expect(diagnostics[0]).toMatchObject({ file: 'src/plugins/support-desk/server.ts', line: 2, column: 7 });
    expect(diagnostics[2].message).toContain('db.read');
  });

  it('rejects undeclared network access', () => {
    expect(codes(`
      export async function register(context: any) {
        await fetch('https://evil.example/collect');
        await context.fetch('https://evil.example/collect');
        await context.fetch(context.url);
        new WebSocket('wss://evil.example');
      }
    `)).toEqual(['COSSACK_PLUGIN_NETWORK', 'COSSACK_PLUGIN_NETWORK', 'COSSACK_PLUGIN_NETWORK', 'COSSACK_PLUGIN_NETWORK']);
    expect(codes(`import net from 'node:net'; export const x = net;`)).toEqual(['COSSACK_PLUGIN_NETWORK']);
    expect(codes(`export const x = (c: any) => c.fetch('https://api.example.com/ok');`)).toEqual([]);
  });

  it('rejects undeclared permissions, resources and hooks', () => {
    expect(codes(`
      import { afterCommit, hasPermission } from '@cossackframework/cms';
      export function register(context: any, principal: any) {
        hasPermission(principal, 'cms:users');
        context.cms.resource('cms/pages');
        context.hooks.addAction(afterCommit, () => {});
        return { access: { read: { permission: 'support-desk:secret' } } };
      }
    `)).toEqual(['COSSACK_PLUGIN_PERMISSION', 'COSSACK_PLUGIN_PERMISSION', 'COSSACK_PLUGIN_HOOK', 'COSSACK_PLUGIN_PERMISSION']);
    const manifestOnly = lintPlugin({ manifest: { ...manifest, commands: [{ name: 'close', description: 'x', permission: 'cms:users' }] }, files: [], parse: parseSync });
    expect(manifestOnly).toEqual([expect.objectContaining({ code: 'COSSACK_PLUGIN_PERMISSION', file: 'src/plugins/support-desk/plugin.json' })]);
  });

  it('checks form hooks against the manifest', () => {
    const source = `
      import { formSubmitted, formValidate } from '@cossackframework/cms';
      export function register(context: any) {
        context.hooks.addFilter(formValidate, (errors: any) => errors);
        context.hooks.addAction(formSubmitted, () => {});
      }
    `;
    expect(codes(source)).toEqual(['COSSACK_PLUGIN_HOOK', 'COSSACK_PLUGIN_HOOK']);
    expect(codes(source, { hooks: [{ point: 'cms.form.validate', version: 1 }, { point: 'cms.form.submitted', version: 1 }] })).toEqual([]);
  });

  it('treats the collections a plugin ships as its own', () => {
    const source = `export const loaders = { entry: (_: unknown, { cms, principal }: any) => cms.resource('cms/projects').list({}, { principal }) };`;
    expect(codes(source)).toEqual(['COSSACK_PLUGIN_PERMISSION']);
    expect(codes(source, { collections: [{ name: 'projects', label: 'Projects', singular: 'Project', fields: {} }] })).toEqual([]);
  });

  it('checks capabilities and their secrets against the manifest', () => {
    const source = `
      export function register(context: any) {
        context.jobs.handle('digest', async () => {
          const key = await context.secrets.get('STRIPE_SECRET_KEY');
          await context.mail.send({ to: 'a@b.co', subject: 'Hi', text: key ?? '' });
          await context.files.upload({ name: 'x.txt', contentType: 'text/plain', body: 'x' });
          await context.cache.set('k', 1);
          await context.users.list();
        });
      }
    `;
    // Nothing declared: every member (jobs, secrets, mail, files, cache, users) and the secret itself are reported.
    expect(codes(source).sort()).toEqual([...Array(6).fill('COSSACK_PLUGIN_PERMISSION'), 'COSSACK_PLUGIN_SECRET']);
    const granted = { permissions: { ...manifest.permissions, jobs: true, mail: true, files: true, cache: true, users: ['read'], secrets: ['STRIPE_SECRET_KEY'] } };
    expect(codes(source, granted)).toEqual([]);
    expect(codes(`const v = context.secrets.get(name);`, granted)).toEqual(['COSSACK_PLUGIN_SECRET']);
    expect(codes(`const v = context.secrets.get('OTHER_KEY');`, granted)).toEqual(['COSSACK_PLUGIN_SECRET']);
  });

  it('rejects host secrets', () => {
    expect(codes(`
      export function read(c: any, env: any) {
        return [c.env.ROMEDB_TOKEN, env.APP_SECRET, process.env.HOME, env['STRIPE_SECRET']];
      }
    `)).toEqual(['COSSACK_PLUGIN_SECRET', 'COSSACK_PLUGIN_SECRET', 'COSSACK_PLUGIN_SECRET', 'COSSACK_PLUGIN_SECRET']);
  });

  it('confines request-context access to the plugin-scoped host', () => {
    expect(codes(`export const ok = (c: any) => c.get('cms').pluginCms('support-desk').resource('support-desk/tickets');`)).toEqual([]);
    expect(codes(`export const whole = (c: any) => c.get('cms').resource('cms/posts');`)).toEqual(['COSSACK_PLUGIN_RAW_QUERY']);
    expect(codes(`export const other = (c: any) => c.get('cms').pluginCms('billing');`)).toEqual(['COSSACK_PLUGIN_PERMISSION']);
    expect(codes(`export const auth = (c: any) => c.get('cmsAuth');`)).toEqual(['COSSACK_PLUGIN_RAW_QUERY']);
  });

  it('reports a file that does not parse', () => {
    expect(codes('export const = ;')).toEqual(['COSSACK_PLUGIN_PARSE']);
  });

  it('maps every CMS extension point export', async () => {
    const hooks = await import('../../cms/src/hooks.ts');
    expect(Object.fromEntries(hooks.EXTENSION_POINTS.map(point => [Object.entries(hooks).find(([, value]) => value === point)[0], point.name]))).toEqual(EXTENSION_POINT_EXPORTS);
  });
});
