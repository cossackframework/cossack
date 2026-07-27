import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { serveStudioAsset } from '../src/server/http';

const temporaryDirectories: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cossack-studio-http-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, 'assets'));
  const source = 'export const studio = true;\n'.repeat(256);
  await writeFile(path.join(root, 'assets', 'studio.hash.js'), source);
  return { root, source };
}

function responseSink() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string | number | readonly string[]>();
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & {
    statusCode: number;
    setHeader(name: string, value: string | number | readonly string[]): void;
  };
  response.statusCode = 0;
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  return { response, headers, body: () => Buffer.concat(chunks) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe('Studio static assets', () => {
  it.each([
    ['br', brotliDecompressSync],
    ['gzip', gunzipSync],
  ] as const)('compresses hashed assets with %s', async (encoding, decompress) => {
    const { root, source } = await fixture();
    const target = responseSink();

    expect(await serveStudioAsset({
      method: 'GET',
      url: '/assets/studio.hash.js',
      headers: { 'accept-encoding': encoding },
    } as any, target.response as any, root)).toBe(true);

    expect(target.headers.get('content-encoding')).toBe(encoding);
    expect(target.headers.get('vary')).toBe('Accept-Encoding');
    expect(target.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(decompress(target.body()).toString()).toBe(source);
  });

  it('keeps HEAD responses uncompressed with their original length', async () => {
    const { root, source } = await fixture();
    const target = responseSink();

    expect(await serveStudioAsset({
      method: 'HEAD',
      url: '/assets/studio.hash.js',
      headers: { 'accept-encoding': 'br, gzip' },
    } as any, target.response as any, root)).toBe(true);

    expect(target.headers.has('content-encoding')).toBe(false);
    expect(target.headers.get('content-length')).toBe(Buffer.byteLength(source));
    expect(target.body()).toHaveLength(0);
  });

  it('does not use an encoding explicitly disabled by the client', async () => {
    const { root, source } = await fixture();
    const target = responseSink();

    await serveStudioAsset({
      method: 'GET',
      url: '/assets/studio.hash.js',
      headers: { 'accept-encoding': 'br;q=0, gzip' },
    } as any, target.response as any, root);

    expect(target.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(target.body()).toString()).toBe(source);
  });
});
