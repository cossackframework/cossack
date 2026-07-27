import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  constants as zlibConstants,
  createBrotliCompress,
  createGzip,
} from 'node:zlib';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg']);

function acceptsEncoding(header: string, encoding: string) {
  return header.split(',').some((value) => {
    const [name, ...parameters] = value.trim().toLowerCase().split(';');
    if (name !== encoding && name !== '*') return false;
    const quality = parameters
      .map((parameter) => parameter.trim().match(/^q=(\d*(?:\.\d+)?)$/)?.[1])
      .find((value) => value !== undefined);
    return quality === undefined || Number(quality) > 0;
  });
}

function acceptedCompression(request: IncomingMessage, extension: string, size: number) {
  if (
    request.method === 'HEAD' ||
    size < 1_024 ||
    !compressibleExtensions.has(extension)
  ) {
    return undefined;
  }
  const accepted = String(request.headers['accept-encoding'] ?? '');
  if (acceptsEncoding(accepted, 'br')) return 'br';
  if (acceptsEncoding(accepted, 'gzip')) return 'gzip';
  return undefined;
}

export async function serveStudioAsset(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<boolean> {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://studio.local').pathname);
  if (pathname === '/' || !['GET', 'HEAD'].includes(request.method ?? 'GET')) return false;
  const relative = pathname.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return false;
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const extension = path.extname(resolved);
  const compression = acceptedCompression(request, extension, stat.size);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes[extension] ?? 'application/octet-stream');
  response.setHeader(
    'Cache-Control',
    relative.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  if (compression) {
    response.setHeader('Content-Encoding', compression);
    response.setHeader('Vary', 'Accept-Encoding');
  } else {
    response.setHeader('Content-Length', stat.size);
  }
  if (request.method === 'HEAD') response.end();
  else if (compression === 'br') {
    await pipeline(
      createReadStream(resolved),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
        },
      }),
      response,
    );
  } else if (compression === 'gzip') {
    await pipeline(createReadStream(resolved), createGzip(), response);
  } else {
    await pipeline(createReadStream(resolved), response);
  }
  return true;
}

export async function toWebRequest(request: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? 'GET';
  const body = ['GET', 'HEAD'].includes(method)
    ? undefined
    : Readable.toWeb(request) as ReadableStream<Uint8Array>;
  return new Request(new URL(request.url ?? '/', origin), {
    method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  } as RequestInit);
}

export async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(response.body as any)
      .once('error', reject)
      .once('end', resolve)
      .pipe(target);
  });
}
