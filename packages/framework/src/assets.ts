import type { MiddlewareHandler } from 'hono';
import { TrieRouter } from 'hono/router/trie-router';
import { compareHttpRoutes, filePathToHttpRoute, resolvePageRouteFiles, type RouterContext } from './route-ids.js';
import { withRuntimeRouteParams } from './runtime-websocket.js';

interface AssetOwner { filePath: string; pattern: string }
interface AssetsBinding { fetch(request: Request): Promise<Response> }

/** Serve assets inside the request pipeline, including their enclosing policies. */
export function createAssetsMiddleware(ctx: RouterContext): MiddlewareHandler {
  const exact = new TrieRouter<AssetOwner>();
  const namespaces = new TrieRouter<AssetOwner>();
  const owners = resolvePageRouteFiles(Object.keys(ctx.pages)).map(filePath => ({
    filePath, pattern: filePathToHttpRoute(filePath),
  })).sort((a, b) => compareHttpRoutes(a.pattern, b.pattern));
  for (const owner of owners) {
    exact.add('GET', owner.pattern, owner);
  }
  // Descendants use the nearest page namespace. A root page does not own
  // every public file; source-directory layout policies still apply below.
  for (const owner of [...owners].sort((a, b) => b.pattern.split('/').length - a.pattern.split('/').length || compareHttpRoutes(a.pattern, b.pattern))) {
    if (owner.pattern !== '/') namespaces.add('GET', `${owner.pattern}/*`, owner);
  }

  return async (c, next) => {
    // Upgrade handshakes belong to the transport pipeline. ASSETS is an HTTP
    // binding (a Node middleware bridge in Vite dev), not a WebSocket proxy.
    // Forwarding the handshake there can crash Miniflare before /ws runs.
    if (c.req.header('upgrade')) return next();
    const assets = c.env?.ASSETS as AssetsBinding | undefined;
    if (!assets?.fetch || !['GET', 'HEAD'].includes(c.req.method)) return next();
    // Encoded separators can be interpreted differently by route and asset
    // matchers. Such requests stay in the normal SSR/404 pipeline.
    if (/%(?:2f|5c)/i.test(new URL(c.req.url).pathname)) return next();
    const pathname = c.req.path;
    // Empty segments (`//host`) and backslashes can turn an alias redirect
    // into a protocol-relative, off-site Location. Leave them to SSR/404.
    if (pathname.includes('//') || pathname.includes('\\')) return next();
    const canonical = pathname.endsWith('/index.html')
      ? pathname.slice(0, -'/index.html'.length) || '/'
      : pathname.endsWith('.html') ? pathname.slice(0, -'.html'.length) || '/' : pathname;
    const exactMatch = exact.match('GET', canonical);
    const match = exactMatch[0].length ? exactMatch : namespaces.match('GET', pathname);
    const selected = match[0][0];
    const owner = selected?.[0];
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(selected?.[1] ?? {})) {
      const encoded = typeof value === 'number' ? match[1]?.[value] : value;
      if (encoded !== undefined) {
        try { params[key] = decodeURIComponent(encoded); } catch { return c.text('Invalid asset path', 400); }
      }
    }

    // Known HTML aliases return to the canonical route. Global policies that
    // match an exact page URL therefore run on that canonical request too.
    const alias = canonical !== pathname && exactMatch[0].length > 0;
    const fetched = alias ? undefined : await assets.fetch(new Request(c.req.raw));
    if (fetched?.status === 404) {
      await fetched.body?.cancel();
      return next();
    }
    // Fetch responses can have immutable headers. Copy the response wrapper
    // while retaining its stream so after-next middleware can add headers.
    const response = fetched ? new Response(fetched.body, fetched) : undefined;
    const middlewares = ctx.getMiddlewares?.(owner?.filePath ?? `/src/pages${pathname}/index.ts`) ?? [];
    const context = withRuntimeRouteParams(c, params);
    let index = -1;
    const dispatch = async (position: number): Promise<void> => {
      if (position <= index) throw new Error('next() called multiple times');
      index = position;
      const middleware = middlewares[position];
      if (!middleware) {
        c.res = alias ? c.redirect(`/${canonical.replace(/^[/\\]+/, '')}${new URL(c.req.url).search}`, 308) : response!;
        return;
      }
      const result = await middleware(context, () => dispatch(position + 1));
      if (result) c.res = result;
    };
    try {
      await dispatch(0);
      return c.res;
    } finally {
      if (response?.body && response.body !== c.res.body) await response.body.cancel();
    }
  };
}
