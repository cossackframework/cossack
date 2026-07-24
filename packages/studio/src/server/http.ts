import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

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
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes[path.extname(resolved)] ?? 'application/octet-stream');
  response.setHeader('Content-Length', stat.size);
  if (request.method === 'HEAD') response.end();
  else createReadStream(resolved).pipe(response);
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
