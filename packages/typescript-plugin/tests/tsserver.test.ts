import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Runs the JavaScript tsserver an editor such as VS Code runs, with the plugin
// listed in the fixture project's tsconfig.json and found in its node_modules.
const packages = path.resolve(import.meta.dirname, '../..');
const tsserver = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript-api/package.json')), 'lib/tsserver.js');

const VIEW = `import { CossackElement, html } from '@cossackframework/renderer';

class Card extends CossackElement {
  declare props: { padding?: 'sm' | 'lg'; title: string };
  render() { return html\`<section>\${this.children}</section>\`; }
}

export const view = (label: string) => html\`
  <button colour="red" @click=\${(event: KeyboardEvent) => event.key}>\${label}</button>
  <\${Card} title="Card" padding="xl"></\${Card}>
  <input type="text" />
  <butt
\`;
`;

let root: string;
let file: string;
let server: ChildProcessWithoutNullStreams;
let seq = 0;
const pending = new Map<number, (body: any) => void>();

const request = (command: string, args: object) => new Promise<any>((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => reject(new Error(`tsserver did not answer ${command}`)), 60_000);
  pending.set(id, (response) => {
    clearTimeout(timer);
    if (response.success === false) reject(new Error(response.message));
    else resolve(response.body);
  });
  server.stdin.write(`${JSON.stringify({ seq: id, type: 'request', command, arguments: args })}\n`);
});

/** 1-based line and offset of a marker in the view. */
const at = (marker: string, delta = 0) => {
  const index = VIEW.indexOf(marker) + delta;
  const before = VIEW.slice(0, index).split('\n');
  return { line: before.length, offset: before[before.length - 1].length + 1 };
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-typescript-plugin-'));
  await fs.mkdir(path.join(root, 'node_modules/@cossackframework'), { recursive: true });
  await fs.symlink(path.join(packages, 'renderer'), path.join(root, 'node_modules/@cossackframework/renderer'), 'junction');
  await fs.symlink(path.join(packages, 'typescript-plugin'), path.join(root, 'node_modules/@cossackframework/typescript-plugin'), 'junction');
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true,
      lib: ['ESNext', 'DOM', 'DOM.Iterable'], plugins: [{ name: '@cossackframework/typescript-plugin' }] },
    include: ['src'],
  }));
  await fs.mkdir(path.join(root, 'src'));
  file = path.join(root, 'src/view.ts');
  await fs.writeFile(file, VIEW);

  // VS Code passes typescript.tsserver.pluginPaths as probe locations.
  server = spawn(process.execPath, [tsserver, '--disableAutomaticTypingAcquisition', '--pluginProbeLocations', root], { stdio: 'pipe' });
  let buffer = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const header = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!header) break;
      const length = Number(header[1]);
      const body = Buffer.from(buffer.slice(header[0].length));
      if (body.length < length) break;
      const message = JSON.parse(body.subarray(0, length).toString('utf8'));
      buffer = body.subarray(length).toString('utf8');
      if (message.type === 'response') pending.get(message.request_seq)?.(message);
    }
  });
  await request('open', { file, projectRootPath: root });
});

afterAll(async () => {
  server?.kill();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('reports template diagnostics as semantic diagnostics', async () => {
  const diagnostics = await request('semanticDiagnosticsSync', { file });
  const messages = diagnostics.map((diagnostic: any) => ({ line: diagnostic.start.line, column: diagnostic.start.offset, text: diagnostic.text, category: diagnostic.category }));
  expect(messages).toEqual(expect.arrayContaining([
    { line: at('colour').line, column: at('colour').offset, text: '<button> has no attribute "colour". (COSSACK_TEMPLATE_UNKNOWN_ATTRIBUTE)', category: 'error' },
    expect.objectContaining({ line: at('(event: KeyboardEvent)').line, category: 'error', text: expect.stringContaining('COSSACK_TEMPLATE_EVENT_HANDLER') }),
    expect.objectContaining({ line: at('padding="xl"').line, category: 'error', text: expect.stringContaining('The padding prop of Card takes "sm" | "lg", not "xl".') }),
  ]));
  expect(diagnostics.every((diagnostic: any) => diagnostic.source === 'cossack' || !diagnostic.text.includes('COSSACK'))).toBe(true);
});

it('completes tags, attributes, events and component props', async () => {
  const tags = await request('completionInfo', { file, ...at('<butt', 5) });
  expect(tags.entries.map((entry: any) => entry.name)).toContain('button');
  expect(tags.entries.find((entry: any) => entry.name === 'button').replacementSpan).toEqual({ start: at('butt'), end: at('butt', 4) });

  const attributes = await request('completionInfo', { file, ...at('type="text" />', 12) });
  expect(attributes.entries.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['placeholder', 'required', 'aria-label']));

  const events = await request('completionInfo', { file, ...at('@click', 3) });
  expect(events.entries.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['@click', '@change']));

  const props = await request('completionInfo', { file, ...at('title="Card"') });
  expect(props.entries.map((entry: any) => entry.name)).toEqual(expect.arrayContaining(['padding']));
});
