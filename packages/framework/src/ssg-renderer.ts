import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Cossack, PageOptions, AuthenticatedUser } from '@cossackframework/core';
import { App } from './App';
import { renderRoot, TemplateHelpers } from './root';
import type { Context } from 'hono';

// Re-export the PageOptions and SsgOptions for convenience
export type { PageOptions, SsgOptions } from '@cossackframework/core';

export type HtmlTemplate = string | ((helpers: TemplateHelpers) => string);

interface LayoutModule {
  default: new () => Cossack;
}

interface SsgRoute {
  routePath: string;
  filePath: string;
  component: new () => Cossack;
  pageOptions?: PageOptions;
}

interface LayoutStackItem {
  path: string;
  instance: Cossack;
}

/**
 * Convert a file path to a simplified route path.
 * Example: /src/pages/hello/[name]/index.ts -> /hello/[name]
 */
export function filePathToRoutePath(filePath: string): string {
  let route = filePath
    .replace('/src/pages/', '/')
    .replace('/index.ts', '')
    .replace('/index.mdx', '')
    .replace('/index.md', '')
    .replace(/\.(ts|tsx|md|mdx)$/, '');

  // Handle root path: /index (from pages/index/index.ts) or empty (from pages/index.ts) -> /
  if (route === '/index' || route === '') {
    return '/';
  }

  return route;
}

/**
 * Get the layout stack for a given page path.
 */
function getLayoutStack(pagePath: string, layouts: Record<string, LayoutModule>): LayoutStackItem[] {
  const stack: LayoutStackItem[] = [];
  const relativePath = pagePath.replace('/src/pages/', '');
  const parts = relativePath.split('/');

  let currentPath = '/src/pages';

  // Get root layout if it exists
  if (layouts[`${currentPath}/layout.ts`]) {
    const LComp = layouts[`${currentPath}/layout.ts`].default;
    const lInst = new LComp();
    stack.push({ path: `${currentPath}/layout.ts`, instance: lInst });
  }

  for (let i = 0; i < parts.length - 1; i++) {
    currentPath += `/${parts[i]}`;
    const layoutPath = `${currentPath}/layout.ts`;
    if (layouts[layoutPath]) {
      const LComp = layouts[layoutPath].default;
      const lInst = new LComp();
      stack.push({ path: layoutPath, instance: lInst });
    }
  }

  return stack;
}

/**
 * Collect all pages marked for SSG from the pages registry.
 */
export function collectSsgRoutes(pages: Record<string, unknown>, layouts: Record<string, LayoutModule>): SsgRoute[] {
  const routes: SsgRoute[] = [];

  for (const path in pages) {
    const module = pages[path] as any;

    // Skip API routes
    if (path.includes('/src/pages/api/')) continue;

    // Skip 404 and error pages
    if (path.endsWith('/404/index.ts') || path.endsWith('/error/index.ts')) continue;

    const mainExport = Object.values(module)[0];

    // Check if it's a Cossack Component
    if (mainExport && typeof mainExport === 'function' && mainExport.prototype instanceof Cossack) {
      const PageComponent = mainExport as new () => Cossack;
      const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

      // Check if SSG is enabled for this page
      if (pageOptions?.ssg) {
        const routePath = filePathToRoutePath(path);
        routes.push({
          routePath,
          filePath: path,
          component: PageComponent,
          pageOptions,
        });
      }
    }
  }

  return routes;
}

/**
 * Render a single SSG page to HTML.
 *
 * The output is a fully hydration-ready HTML document produced by the same
 * `renderRoot` function used by the SSR runtime, ensuring SSG and SSR output
 * stay structurally identical (client script tag, window.__INITIAL_STATE__,
 * module preloads, CSS, head tags, optional htmlTemplate).
 */
export async function renderSsgPage(
  PageComponent: new () => Cossack,
  routePath: string,
  staticParams?: Record<string, string>,
  layouts: Record<string, LayoutModule> = {},
  baseUrl: string = 'https://example.com',
  AppComponent?: new (...args: any[]) => any,
  htmlTemplate?: HtmlTemplate,
  pageFilePath?: string,
  componentRouteId?: string,
): Promise<string> {
  // Create a mock Hono context for SSR
  const mockContext = createMockContext(routePath, staticParams, baseUrl);

  // Get page options for transport type
  const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);

  const user: AuthenticatedUser = { id: 'ssg-user', name: 'SSG User' };
  const env = {};

  // Bootstrap App
  if (!AppComponent) {
    // No user App was supplied — falling back to the framework's demo App.
    // This is almost always a plumbing mistake (the SSG entry should import and
    // pass the project's own `App`), and results in the wrong <title>/head and
    // missing global tags. Warn loudly so it's not silent.
    console.warn(
      '[cossack/ssg] No AppComponent was passed to renderSsgPage(); falling back to the framework default App. ' +
        'Pass your App (e.g. via `cossack ssg` or renderSsgPage(..., App)) so your head()/title are applied.',
    );
  }
  const appInstance = new (AppComponent ?? App)();
  await appInstance.bootstrap({ context: mockContext, user, env, page: routePath });

  // Bootstrap Layouts
  const layoutInstances: Cossack[] = [];
  const layoutStates: Record<string, any> = {};
  const layoutPaths = getLayoutStack(`/src/pages${routePath.replace(/\//g, '/').replace(/^\//, '')}/index.ts`, layouts);

  for (const layoutItem of layoutPaths) {
    const LComp = layouts[layoutItem.path].default;
    const lInst = new LComp();
    await lInst.bootstrap({ context: mockContext, user, env, page: routePath });
    layoutInstances.push(lInst);
    layoutStates[layoutItem.path] = lInst.getInitialState();
  }

  // Bootstrap Page
  const pageInstance = new PageComponent();

  // Wrap staticParams in SerializedComponentState format for initializeState
  const initialState =
    staticParams && Object.keys(staticParams).length > 0
      ? { public: staticParams, internal: {}, children: {} }
      : undefined;

  await pageInstance.bootstrap({
    context: mockContext,
    user,
    env,
    page: routePath,
    initialState,
  });

  // Force render to populate registry
  pageInstance._render();

  // Wrap rendering
  let body = (pageInstance as any)._getWrappedTemplate();
  for (let i = layoutInstances.length - 1; i >= 0; i--) {
    layoutInstances[i].children = body;
    body = layoutInstances[i]._getWrappedTemplate();
  }
  appInstance.children = body;
  const finalHtml = appInstance._render();

  // Head Merging
  const emptyCtx = Cossack.buildHeadContext([]);
  const pageHeadValue = pageInstance.head(emptyCtx);
  let tags = Cossack.mergeHead(emptyCtx, pageHeadValue);
  for (let i = layoutInstances.length - 1; i >= 0; i--) {
    const headContext = Cossack.buildHeadContext(tags);
    const headValue = layoutInstances[i].head(headContext);
    tags = Cossack.mergeHead(headContext, headValue);
  }
  const finalHeadContext = Cossack.buildHeadContext(tags);
  const appHeadValue = appInstance.head(finalHeadContext);
  const headTags = Cossack.mergeHead(finalHeadContext, appHeadValue);

  // Build the initial state payload, mirroring the SSR handler in router.ts
  // so the client hydration code receives the same shape it expects.
  // Key: routePath must be the ROUTE PATTERN (e.g. "/ssg-demo/users/[username]"),
  // not the concrete URL — the client uses it to look up the page module loader
  // via routeToFilePath, which maps patterns (with [param] brackets) to files.
  const pageInitialState = pageInstance.getInitialState();

  const finalInitialState = {
    ...pageInitialState,
    routePath: pageFilePath ? filePathToRoutePath(pageFilePath) : routePath,
    componentRouteId: componentRouteId ?? routePath,
    appRouteId: 'cossack_app',
    pathname: mockContext.req.path,
    channels: pageOptions?.channels || ['global'],
    transport: pageOptions?.transport || 'http',
    _app_state: appInstance.getInitialState(),
    _layout_stack: layoutPaths.map((item: LayoutStackItem) => ({
      path: item.path,
      state: layoutStates[item.path],
    })),
  };

  const manifest = readManifestFile();
  const modulePreloads = getModulePreloads(manifest, pageFilePath ?? '');

  const html = renderRoot({
    body: finalHtml,
    initialState: finalInitialState,
    manifest,
    headTags,
    modulePreloads,
    htmlTemplate,
  });

  return html;
}

/**
 * Create a mock Hono context for SSG rendering.
 */
function createMockContext(
  path: string,
  params?: Record<string, string>,
  baseUrl: string = 'https://example.com',
): Context {
  const fullUrl = params ? replaceParams(path, params) : path;

  // Create a minimal Hono context mock
  const mockContext = {
    req: {
      path: path,
      url: `${baseUrl}${fullUrl}`,
      param: (key?: string) => {
        if (key && params) {
          return params[key];
        }
        return params || {};
      },
      query: () => ({}),
    },
    get: () => undefined,
    set: () => {},
    header: () => {},
    status: 200,
    body: (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    html: (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    text: (text: string) => new Response(text, { headers: { 'Content-Type': 'text/plain' } }),
    json: (obj: any) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }),
    redirect: (url: string, status?: number) =>
      new Response(null, { status: status || 302, headers: { Location: url } }),
  } as unknown as Context;

  return mockContext;
}

/**
 * Replace route params in a path.
 * Example: /hello/:name with { name: 'tan' } -> /hello/tan
 */
function replaceParams(path: string, params: Record<string, string>): string {
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value);
  }
  return result;
}

/**
 * Read the Vite manifest to get asset file names.
 * Renamed from getManifest to avoid clashing with router.ts's runtime version.
 */
function readManifestFile(): Record<string, any> {
  try {
    const manifestPath = path.join(process.cwd(), 'dist/client/.vite/manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(manifestContent);
  } catch {
    return {};
  }
}

/**
 * Collect modulepreload hrefs for the current page.
 * Mirrors the implementation in router.ts so SSG output matches SSR output.
 */
function getModulePreloads(mfest: Record<string, any>, pagePath: string): string[] {
  if (!pagePath) return [];

  // Strip leading '/' to match Vite manifest keys (e.g. "src/pages/...")
  const normalizedPath = pagePath.replace(/^\//, '');
  const collected = new Set<string>();

  const collect = (key: string) => {
    const entry = mfest[key];
    if (!entry) return;
    if (entry.file && !collected.has(entry.file)) {
      collected.add(entry.file);
    }
    if (entry.imports) {
      for (const imp of entry.imports) {
        if (!collected.has(imp)) {
          collect(imp);
        }
      }
    }
  };

  collect(normalizedPath);

  const entryClient = mfest['src/client/entry-client.ts'];
  if (entryClient?.imports) {
    for (const imp of entryClient.imports) {
      collect(imp);
    }
  }

  const entryClientFile = entryClient?.file;
  const hrefs: string[] = [];
  for (const key of collected) {
    const entry = mfest[key];
    if (entry?.file) {
      if (entry.file !== entryClientFile) hrefs.push(`/${entry.file}`);
    } else if (key.startsWith('assets/')) {
      if (key !== entryClientFile) hrefs.push(`/${key}`);
    }
  }
  return hrefs;
}

/**
 * Get all static params for a dynamic SSG route.
 */
export async function getStaticParams(pageOptions: PageOptions): Promise<Record<string, string>[]> {
  if (typeof pageOptions.ssg === 'object' && pageOptions.ssg.generateStaticParams) {
    return await pageOptions.ssg.generateStaticParams();
  }
  return [{}];
}
