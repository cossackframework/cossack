import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { User } from '@cossackframework/core';
import { filePathToHttpRoute } from './route-ids.js';
import { createRequestContextMiddleware } from './middlewares/request-context.js';

export class SsgPublicRouteError extends Error {
  readonly code = 'COSSACK_SSG_NOT_PUBLIC';

  constructor(routePath: string, reason: string) {
    super(`[cossack/ssg] ${routePath} cannot be published as static HTML: ${reason}. Use SSR for request-dependent pages.`);
    this.name = 'SsgPublicRouteError';
  }
}

interface SsgRequestOptions {
  routePath: string;
  pageFilePath?: string;
  baseUrl: string;
  env: Record<string, unknown>;
  middlewares: readonly MiddlewareHandler[];
  routeMiddlewares: readonly MiddlewareHandler[];
}

/** Run the actual request policies before publishing anonymous, public HTML. */
export async function runPublicSsgRequest(
  options: SsgRequestOptions,
  render: (context: Context) => Promise<string>,
): Promise<string> {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user?: User } }>();
  // Rendering and middleware errors must fail the build, rather than become
  // Hono's default 500 response or be saved as an error document.
  app.onError(error => { throw error; });
  app.use('*', createRequestContextMiddleware());
  for (const middleware of options.middlewares) app.use('*', middleware);

  let rendered = false;
  let context: Context | undefined;
  const route = options.pageFilePath
    ? filePathToHttpRoute(options.pageFilePath)
    : options.routePath;
  for (const middleware of options.routeMiddlewares) app.use(route, middleware);
  app.get(route, async c => {
    context = c;
    if (c.get('user') != null) throw new SsgPublicRouteError(options.routePath, 'middleware supplied an authenticated user');
    const output = await render(c);
    rendered = true;
    return c.html(output);
  });

  // No cookies, authorization, or synthetic identity enter this request.
  const response = await app.request(new URL(options.routePath, options.baseUrl), undefined, options.env);
  const reject = (reason: string): never => { throw new SsgPublicRouteError(options.routePath, reason); };
  if (!rendered) reject(`the anonymous request did not reach the page renderer (HTTP ${response.status})`);
  if (response.status !== 200) reject(`the request returned HTTP ${response.status}`);
  if (context?.get('user') != null) reject('the request acquired an authenticated user');
  if (response.headers.has('Set-Cookie')) reject('the response sets a cookie');
  if (/\b(?:private|no-store)\b/i.test(response.headers.get('Cache-Control') ?? '')) reject('the response requires private caching');
  if (/(?:^|,)\s*(?:cookie|authorization)\s*(?:,|$)/i.test(response.headers.get('Vary') ?? '')) reject('the response varies by visitor credentials');
  return response.text();
}
