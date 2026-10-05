import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

export const SOURCE_MAP_MARKER = 'CF08_PRIVATE_NATIVE_SOURCE_MAP_FAILURE';
export async function writeProductionSourceMapFixture(root) {
  const token = randomUUID();
  const relative = 'src/pages/api/source-map-fault.ts';
  // This catch is a private, random-token protected acceptance channel. It is
  // authored only in the temporary fixture; framework diagnostics stay unchanged.
  const source = `function triggerSourceMapFault(): never {
  throw new Error('${SOURCE_MAP_MARKER}');
}
export const GET = (c: any) => {
  if (c.req.header('x-test-private-stack') !== '${token}') triggerSourceMapFault();
  try { triggerSourceMapFault(); }
  catch (error) { return c.json({ stack: (error as Error).stack }); }
};
`;
  await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await fs.writeFile(path.join(root, relative), source);
  return { token, relative, source, line: 2, column: source.split('\n')[1].indexOf('Error(') };
}

async function walk(root) {
  const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else result.push(file);
  }
  return result;
}

export async function verifyProductionSourceMap(root, origin, fixture) {
  const workerConfig = JSON.parse(await fs.readFile(path.join(root, 'dist/ssr/wrangler.json'), 'utf8'));
  assert.equal(workerConfig.upload_source_maps, true, 'Generated production config must retain source-map upload policy');
  const maps = (await walk(path.join(root, 'dist/ssr'))).filter(file => file.endsWith('.js.map'));
  assert.ok(maps.length > 0, 'Production worker must emit source maps without an extra CLI flag');
  const response = await fetch(origin + '/api/source-map-fault', { headers: { 'x-test-private-stack': fixture.token } });
  assert.equal(response.status, 200);
  const { stack } = await response.json();
  assert.equal(typeof stack, 'string');
  assert.ok(stack.startsWith('Error: ' + SOURCE_MAP_MARKER), 'A real native Worker fault must supply the stack');
  const frames = [...stack.matchAll(/(?:\(|\s)([^\s()]+\.js):(\d+):(\d+)\)?/g)];
  assert.ok(frames.length > 0, 'Native stack must contain generated JavaScript coordinates');
  let resolved;
  for (const [, file, line, column] of frames) {
    const candidates = maps.filter(map => path.basename(map) === path.basename(file) + '.map');
    for (const mapFile of candidates) {
      const generatedFile = mapFile.slice(0, -4);
      const generatedCode = await fs.readFile(generatedFile, 'utf8');
      const urls = [...generatedCode.matchAll(/^\/\/# sourceMappingURL=(\S+)\s*$/gm)];
      assert.ok(urls.length > 0, 'Production JavaScript must link its source map so Wrangler can collect it');
      assert.equal(path.resolve(path.dirname(generatedFile), urls.at(-1)[1]), mapFile,
        'The actual failing generated module must link the exact emitted source map');
      const content = JSON.parse(await fs.readFile(mapFile, 'utf8'));
      const original = originalPositionFor(new TraceMap(content), { line: Number(line), column: Number(column) - 1 });
      if (!original.source?.replaceAll('\\', '/').endsWith(fixture.relative)) continue;
      assert.equal(original.line, fixture.line, 'The actual native stack must map to the authored throw line');
      assert.equal(original.column, fixture.column, 'The actual native stack must map to the authored Error constructor identifier column');
      const index = content.sources.findIndex(source => source.replaceAll('\\', '/').endsWith(fixture.relative));
      assert.equal(content.sourcesContent?.[index], fixture.source, 'The emitted map must embed the exact authored TypeScript');
      resolved = { file: original.source, line: original.line, column: original.column, generatedLine: Number(line), generatedColumn: Number(column) };
      break;
    }
    if (resolved) break;
  }
  assert.ok(resolved, 'At least one actual native stack frame must resolve through its corresponding emitted map');

  const exposedMap = await fetch(origin + '/' + path.basename(maps[0]));
  assert.equal(exposedMap.status, 404, 'Private server maps must not be served as public static assets');
  assert.ok(!(await exposedMap.text()).includes(SOURCE_MAP_MARKER));

  const publicFault = await fetch(origin + '/api/source-map-fault');
  assert.equal(publicFault.status, 500);
  const publicText = await publicFault.text();
  assert.ok(!publicText.includes(SOURCE_MAP_MARKER), 'Public error responses must not reveal private native errors');
  assert.ok(!publicText.includes(fixture.relative), 'Public error responses must not reveal authored file locations');
  for (const file of await walk(path.join(root, 'dist/client'))) {
    if (!/\.(?:js|map|html)$/.test(file)) continue;
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!text.includes(SOURCE_MAP_MARKER) && !text.includes(fixture.token), 'Private fixture data must not enter client artifacts');
  }
  return resolved;
}

export async function verifyWranglerSourceMapArtifacts(root, outfile, fixture) {
  // Wrangler's --outdir omits the prebundled entry map. --outfile serializes
  // the actual prepared Worker upload FormData before dry-run returns, including
  // source maps selected by Wrangler. Inspect those real parts, not copied files.
  const bytes = await fs.readFile(outfile);
  const boundary = bytes.toString('utf8', 0, bytes.indexOf('\r\n')).slice(2);
  assert.ok(boundary.length > 0, 'Wrangler must write its actual multipart upload body');
  const upload = await new Response(bytes, {
    headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
  }).formData();
  const maps = [...upload.entries()].filter(([name, value]) => name.endsWith('.js.map') && typeof value !== 'string');
  assert.ok(maps.length > 0, 'Wrangler prepared upload must contain actual source-map parts');
  let matched = false;
  for (const [name, value] of maps) {
    assert.equal(value.type, 'application/source-map', 'Wrangler must mark source maps as private upload maps');
    const map = JSON.parse(await value.text());
    const index = map.sources.findIndex(source => source.replaceAll('\\', '/').endsWith(fixture.relative));
    if (index < 0) continue;
    assert.equal(map.sourcesContent?.[index], fixture.source,
      'Wrangler deployment output must retain the authored TypeScript, not a map only to generated code');
    const generated = upload.get(name.slice(0, -4));
    assert.ok(generated && typeof generated !== 'string', 'The deployment map must accompany the actual generated Worker module');
    const production = await fs.readFile(path.join(root, 'dist/ssr', path.basename(name.slice(0, -4))), 'utf8');
    assert.equal(await generated.text(), production,
      'Wrangler dry-run module must be the same production module whose native fault was verified');
    matched = true;
  }
  assert.ok(matched, 'Wrangler dry-run prepared upload must contain the original fixture TypeScript map');
}
