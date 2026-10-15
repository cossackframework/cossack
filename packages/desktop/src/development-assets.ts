import { stat } from 'node:fs/promises';
import path from 'node:path';

// Vite's own exclusions in its public-file middleware: `?import` and `?url`
// requests are transformed into modules, and internal prefixes are never files.
const importQuery = /(?:\?|&)import=?(?:&|$)/;
const urlQuery = /(?:\?|&)url(?:&|$)/;
const internalPrefix = /^\/@(?:fs\/|id\/|vite\/client|vite\/env)/;

/**
 * True when Vite would answer this request with a plain file from `publicDir`.
 * Desktop development sends these requests through the application, so global
 * and page policies run before the file is served, as in production. Vite
 * still answers its client, modules and other requests first.
 */
export async function isPublicFileRequest(request: Request, publicDir: string): Promise<boolean> {
  if (!publicDir || (request.method !== 'GET' && request.method !== 'HEAD')) return false;
  const url = new URL(request.url);
  const target = url.pathname + url.search;
  if (importQuery.test(target) || urlQuery.test(target) || internalPrefix.test(url.pathname)) return false;
  let pathname: string;
  try {
    pathname = decodeURI(url.pathname);
  } catch {
    return false;
  }
  const root = path.resolve(publicDir);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) return false;
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
