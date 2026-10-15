// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { build, createLogger, createServer } from 'vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkReservedPaths, checkTransportRouteNamespace } from '../src/reserved-paths';
import { cossackPages } from '../src/vite-plugin';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-reserved-paths-')); roots.push(root);
  for (const [file, source] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), source);
  }
  return root;
}

const page = 'export default class Route {}';
/** One route file per reserved path, with the path it must report. */
const reserved: [file: string, pattern: string, reservedPath: string][] = [
  ['src/pages/crpc/index.ts', '/crpc', '/crpc'],
  ['src/pages/upload.ts', '/upload', '/upload'],
  ['src/pages/(realtime)/sse/[id]/index.ts', '/sse/:id', '/sse/'],
  ['src/pages/sse/streams/live/index.ts', '/sse/streams/live', '/sse/'],
  ['src/pages/ws/[room].ts', '/ws/:room', '/ws/'],
  ['src/pages/ws/chat/[...path]/index.ts', '/ws/chat/:path{.+}', '/ws/'],
];
/** Routes beside the reservations that the router lets pages own. */
const nearMisses = [
  'src/pages/crpcx/index.ts', 'src/pages/websocket.ts', 'src/pages/sse-info/index.ts', 'src/pages/ws/index.ts', 'src/pages/sse.ts',
  'src/pages/crpc/x/index.ts', 'src/pages/upload/files.ts', 'src/pages/api/crpc.ts', 'src/pages/[slug].ts', 'src/pages/ws/404/index.ts',
];

describe('reserved transport paths check', () => {
  it('reports each route at a transport path with its source file and reserved path', async () => {
    const root = await fixture(Object.fromEntries([...reserved.map(([file]) => file), ...nearMisses].map(file => [file, page])));
    const diagnostics = checkTransportRouteNamespace(root);
    expect(diagnostics.map(({ file, reservedPath }) => [file, reservedPath])).toEqual(
      [...reserved].sort(([a], [b]) => a.localeCompare(b)).map(([file, , reservedPath]) => [join(root, file), reservedPath]));
    for (const [file, pattern, reservedPath] of reserved) {
      const diagnostic = diagnostics.find(candidate => candidate.file === join(root, file))!;
      expect(diagnostic.code).toBe('COSSACK_TRANSPORT_ROUTE_RESERVED');
      expect(diagnostic.message).toContain(`${file.replace(/^\/+/, '')} resolves to ${reservedPath.endsWith('/') ? pattern : reservedPath}`);
      expect(diagnostic.message).toContain(reservedPath.endsWith('/') ? `inside the ${reservedPath} namespace` : `${reservedPath}, which is reserved`);
      expect(diagnostic.message).toContain('this route never runs. Rename the route.');
    }
  });

  it('includes Markdown routes when scanning, unless disabled', async () => {
    const root = await fixture({ 'src/pages/ws/notes.md': '# Notes' });
    expect(checkTransportRouteNamespace(root).map(diagnostic => diagnostic.reservedPath)).toEqual(['/ws/']);
    expect(checkTransportRouteNamespace(root, { includeMarkdown: false })).toEqual([]);
  });

  it('combines the /assets and transport diagnostics from one route list', async () => {
    const root = await fixture({ 'public/assets/logo.svg': '<svg/>', 'src/pages/assets/index.ts': page, 'src/pages/crpc.ts': page });
    expect(checkReservedPaths(root).map(diagnostic => diagnostic.code)).toEqual([
      'COSSACK_ASSETS_NAMESPACE_RESERVED', 'COSSACK_ASSETS_NAMESPACE_RESERVED', 'COSSACK_TRANSPORT_ROUTE_RESERVED']);
    // Callers that already discovered routes are not rescanned.
    expect(checkReservedPaths(root, { routes: [], publicDir: false })).toEqual([]);
  });
});

describe('cossackPages reserved transport paths', () => {
  const entry = { 'src/client/entry-client.ts': 'export const loaded = true;' };
  const clientBuild = (root: string) => build({
    root, configFile: false, logLevel: 'silent', customLogger: createLogger('silent'), plugins: [cossackPages()],
    build: { outDir: 'dist/client', emptyOutDir: true, minify: false, rolldownOptions: { input: join(root, 'src/client/entry-client.ts') } },
  });

  it.each(reserved)('fails the build for %s', async (file, pattern, reservedPath) => {
    const root = await fixture({ ...entry, [file]: page });
    await expect(clientBuild(root)).rejects.toMatchObject({
      message: expect.stringContaining(`${file} resolves to ${reservedPath.endsWith('/') ? pattern : reservedPath}`),
    });
  });

  it('builds near misses', async () => {
    const root = await fixture({ ...entry, ...Object.fromEntries(nearMisses.map(file => [file, page])) });
    await expect(clientBuild(root)).resolves.toBeDefined();
  });

  it('warns in development at startup and once more when a route change adds a conflict', async () => {
    const root = await fixture({ 'src/pages/crpc/index.ts': page });
    const warnings: string[] = [];
    const customLogger = createLogger('warn', { allowClearScreen: false });
    customLogger.warn = message => { warnings.push(message); };
    const server = await createServer({ root, configFile: false, customLogger, server: { middlewareMode: true, watch: null },
      plugins: [cossackPages()] });
    try {
      expect(warnings.filter(warning => warning.includes('COSSACK') || warning.includes('resolves to'))).toHaveLength(1);
      expect(warnings.join('\n')).toContain('src/pages/crpc/index.ts resolves to /crpc');
      warnings.length = 0;
      const added = join(root, 'src/pages/ws/[room].ts');
      await mkdir(dirname(added), { recursive: true });
      await writeFile(added, page);
      server.watcher.emit('add', added);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('src/pages/ws/[room].ts resolves to /ws/:room');
      expect(warnings[0]).not.toContain('src/pages/crpc/index.ts');
    } finally { await server.close(); }
  });
});
