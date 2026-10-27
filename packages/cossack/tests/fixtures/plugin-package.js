// A plugin package written to disk and packed with `npm pack`, for plugin recipe tests.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const SERVER_MARKER = 'support-desk-server-only-marker';

function sources(version) {
  return {
    // A plugin's pages are ordinary routes: a page whose failure the application's error handling takes.
    // (A `pages/support/loading.ts` here left the plugin's configuration empty at runtime; see plan-cms-ux-improvements.md.)
    'pages/support/broken/index.ts': `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class Broken extends Cossack {
  async init() {
    throw new Error('The desk is closed.');
  }

  render() {
    return html\`<p>Never shown</p>\`;
  }
}
`,
    'pages/support/index.ts': `import { __, Client, Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { config } from '@cossackframework/framework/config';
import { plugins } from '@cossackframework/framework/plugins';
import { DeskBadge } from '../../components/DeskBadge';

const SECRET = '${SERVER_MARKER}';

@Page({ transport: 'http' })
export default class SupportDesk extends Cossack {
  @State() tickets = 0;
  @State() greeting = '';
  @State() registry = '';

  async init() {
    this.greeting = config('support-desk::desk.greeting', 'missing');
    this.registry = plugins.map(plugin => \`\${plugin.name}@\${plugin.version}:\${plugin.manifest?.description ?? ''}\`).join(',');
  }

  /** Server-only: never shipped to the browser. */
  private audit(): string {
    return SECRET;
  }

  @Server()
  async open(): Promise<number> {
    this.audit();
    this.tickets += 1;
    return this.tickets;
  }

  @Client()
  onMount() {
    (window as unknown as { __desk: SupportDesk }).__desk = this;
  }

  render() {
    return html\`<main>
      <h1 data-testid="title">\${__('support-desk::title')}</h1>
      <p data-testid="greeting">\${this.greeting}</p>
      <p data-testid="registry">\${this.registry}</p>
      <p data-testid="version">v${version}</p>
      <\${DeskBadge} label="Tickets: \${this.tickets}"></\${DeskBadge}>
      <button type="button" @click=\${() => this.open()}>Open ticket</button>
    </main>\`;
  }
}
`,
    'components/DeskBadge.ts': `import { Component, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Component()
export class DeskBadge extends Cossack {
  declare props: { label: string };

  render() {
    return html\`<span data-testid="badge">\${this.props.label}</span>\`;
  }
}
`,
    'lang/en.json': JSON.stringify({ title: 'Support desk' }) + '\n',
    'config/desk.ts': `export default () => ({ greeting: 'Hello from plugin configuration' });\n`,
    'middlewares.ts': `import type { MiddlewareHandler } from 'hono';

const tag: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('x-support-desk', '${version}');
};

export default [tag];
`,
  };
}

/** Write the plugin package for `version` and pack it; returns `{ directory, tarball }`. */
export async function packPlugin(version, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `support-desk-${version}-`));
  const files = {
    'package.json': JSON.stringify({
      name: '@acme/support-desk', version, type: 'module', cossack: { plugin: 'cossack-plugin.json' },
      files: ['plugin', 'cossack-plugin.json'],
      // A package that ran on install would fail the test.
      scripts: { preinstall: 'node -e "process.exit(1)"', postinstall: 'node -e "require(\'fs\').writeFileSync(\'/tmp/support-desk-ran\', \'1\')"' },
    }, null, 2),
    'cossack-plugin.json': JSON.stringify({ schemaVersion: 1, name: 'support-desk', version, description: 'Ticket desk',
      compatibility: { '@cossackframework/framework': '>=0.9.0' } }, null, 2),
    ...Object.fromEntries(Object.entries({ ...sources(version), ...overrides }).map(([rel, content]) => [`plugin/${rel}`, content])),
  };
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
    await fs.writeFile(path.join(directory, rel), content);
  }
  const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory], { cwd: directory });
  return { directory, tarball: path.join(directory, stdout.trim().split('\n').pop()) };
}
