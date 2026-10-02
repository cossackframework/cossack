import fs from 'node:fs';
import path from 'node:path';
import { extractMethodClassificationsFromAst } from './page-options-ast.js';
import { extractPageOptionsFromAst } from './page-options-ast.js';
import { computeRouteIds, resolvePageRouteFiles } from '@cossackframework/framework/route-ids';

/**
 * Pure route derivation replicated from the framework router
 * (packages/framework/src/router.ts, route-registration loop):
 *
 *   route = filePath
 *     .replace('/src/pages', '')
 *     .replace(/\.(ts|js|md|mdx)$/, '')
 *     .replace(/\/index$/, '')
 *     .replace(/\/\([^)]+\)/g, '')     // strip route groups (auth)
 *     .replace(/\[([^\]]+)\]/g, ':$1') // [name] -> :name
 *     || '/'
 *
 * This is the single place the CLI derives URLs so `cossack routes` always
 * matches what the running app actually registers.
 */
export function filePathToHttpRoute(filePath) {
  let route = filePath
    .replace('/src/pages', '')
    .replace(/\.(ts|js|md|mdx)$/, '')
    .replace(/\/index$/, '')
    .replace(/\/\([^)]+\)/g, '')
    // Mirror the framework exactly: catch-alls become Hono multi-segment
    // params before the generic dynamic rule can mangle them.
    .replace(/\[\.\.\.([^\]]+)\]/g, ':$1{.+}')
    .replace(/\[([^\]]+)\]/g, ':$1');
  if (!route) route = '/';
  if (route === '/index') route = '/';
  return route;
}

/** Directory scope of a path, e.g. /src/pages/(auth)/login/index.ts -> /(auth)/login */
function dirScope(filePath) {
  const rel = filePath.replace('/src/pages/', '');
  const parts = rel.split('/');
  parts.pop(); // drop filename
  return '/src/pages/' + parts.join('/');
}

export function classifyRoute(routePath) {
  if (routePath.endsWith('/404') || routePath === '/404') return '404';
  if (routePath.endsWith('/error') || routePath === '/error') return 'error';
  if (routePath.includes('/api/') || routePath === '/api' || routePath.startsWith('/api')) return 'api';
  return 'page';
}

/**
 * Walk `src/pages` reproducing the Vite glob key set:
 *   pages   = *.ts/*.mdx excluding layout.ts/loading.ts
 *   layouts = layout.ts
 *
 * Returns sorted { pageKeys, layoutKeys } in `/src/pages/<rel>` form
 * (forward slashes), exactly like the framework's scanPagesDir.
 */
export function scanPagesDir(pagesDir) {
  const pageKeys = [];
  const layoutKeys = [];
  if (!fs.existsSync(pagesDir)) return { pageKeys, layoutKeys };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(pagesDir, full).split(path.sep).join('/');
        const key = `/src/pages/${rel}`;
        if (entry.name === 'layout.ts') {
          layoutKeys.push(key);
        } else if (entry.name === 'loading.ts') {
          // excluded, matches glob negation
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mdx')) {
          pageKeys.push(key);
        }
      }
    }
  };
  walk(pagesDir);
  pageKeys.sort();
  layoutKeys.sort();
  return { pageKeys, layoutKeys };
}

/**
 * Build the route model used by `cossack routes`.
 * pages:  [{ filePath, route, kind }]
 * layouts: [{ filePath, scope }]
 */
export function buildRouteModel(projectRoot) {
  const pagesDir = path.join(projectRoot, 'src', 'pages');
  const { pageKeys, layoutKeys } = scanPagesDir(pagesDir);

  const pages = resolvePageRouteFiles(pageKeys).map((filePath) => {
    const route = filePathToHttpRoute(filePath);
    return { filePath, route, kind: classifyRoute(route) };
  });

  const layouts = layoutKeys.map((filePath) => ({
    filePath,
    scope: dirScope(filePath),
  }));

  return { pages, layouts };
}

/**
 * Return the layout stack (filePaths) that wrap a given page, root-first.
 * Replicates router.getLayoutStack: walk parent dirs collecting layout.ts.
 */
export function layoutStackForPage(pageFilePath, layoutKeys) {
  const rel = pageFilePath.replace('/src/pages/', '');
  const parts = rel.split('/');
  const stack = [];
  let current = '/src/pages';
  // root layout
  if (layoutKeys.includes(`${current}/layout.ts`)) {
    stack.push(`${current}/layout.ts`);
  }
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`;
    const lp = `${current}/layout.ts`;
    if (layoutKeys.includes(lp)) stack.push(lp);
  }
  return stack;
}


/**
 * Extract dynamic route parameters from a route path: `:name` -> `name`,
 * framework catch-alls (`:name{.+}` from `[...name]`) marked `catchAll: true`.
 * Static segments yield nothing.
 */
export function extractRouteParams(route) {
  const params = [];
  for (const segment of route.split('/')) {
    const catchAll = segment.match(/^:(\w[\w-]*)\{\.\+\}$/);
    if (catchAll) {
      params.push({ name: catchAll[1], catchAll: true });
      continue;
    }
    const dynamic = segment.match(/^:(\w[\w-]*)$/);
    if (dynamic) params.push({ name: dynamic[1], catchAll: false });
  }
  return params;
}

/**
 * Source-level @Page option extraction WITHOUT executing the module: reads
 * the decorator call text only. Transport, SSG, and middleware count are the
 * facts inspection needs; middleware identities live in code, not metadata.
 */
export function extractPageOptions(source) {
  if (!source) return { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
  const decorator = source.match(/@Page\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!decorator) return { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
  const body = decorator[1];
  const transport = body.match(/transport\s*:\s*['"](http|sse|durable-object)['"]/);
  const ssg = body.match(/ssg\s*:\s*(true|false)/);
  const middlewares = body.match(/middlewares\s*:\s*\[([\s\S]*?)\]/);
  const services = body.match(/services\s*:\s*\[([^\]]*)\]/);
  return {
    transport: transport ? transport[1] : null,
    ssg: ssg ? ssg[1] === 'true' : null,
    middlewares: middlewares ? countTopLevelEntries(middlewares[1]) : 0,
    // Declared service class names — the ownership facts DI resolution uses.
    services: services
      ? services[1].split(',').map(name => name.trim()).filter(name => /^[A-Za-z_$][\w$]*$/.test(name))
      : [],
    decoratorLine: source.slice(0, decorator.index).split('\n').length,
  };
}

/** Count comma-separated entries at one depth (middleware array members). */
function countTopLevelEntries(text) {
  let depth = 0;
  let entries = 0;
  let inString = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === inString && text[i - 1] !== '\\') inString = null;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') { inString = char; continue; }
    if (char === '[' || char === '(' || char === '{') depth++;
    else if (char === ']' || char === ')' || char === '}') depth--;
    else if (char === ',' && depth === 0) entries++;
  }
  return /\S/.test(text) ? entries + 1 : 0;
}

/**
 * Nearest special-page boundary (404 / error) for a page, mirroring the
 * router's findNearestSpecialPage: walk from the page's directory upward,
 * preferring deeper boundaries.
 */
export function nearestSpecialPage(pageFilePath, pages, type) {
  const rel = pageFilePath.replace('/src/pages/', '');
  const parts = rel.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/');
    const searchPath = dir ? `/src/pages/${dir}/${type}/index.ts` : `/src/pages/${type}/index.ts`;
    if (pages.some((page) => page.filePath === searchPath)) return searchPath;
  }
  return null;
}

/**
 * Effective route metadata model (RT-07): per page, the URL, stable route id
 * (same index-based computation as the runtime's computeRouteIds), dynamic
 * parameters, layout ancestry, nearest 404/error boundaries, and source-level
 * @Page options. Inspection reads facts; it never executes components.
 */
export async function buildEffectiveRouteModel(projectRoot) {
  const model = buildRouteModel(projectRoot);
  const layoutKeys = model.layouts.map((layout) => layout.filePath);
  const { routePathToIdMap } = computeRouteIds(model.pages.map(page => page.filePath), layoutKeys);
  const idFor = filePath => routePathToIdMap.get(filePath) ?? null;
  const pages = [];
  for (const page of model.pages) {
    let options = { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
    let method = 'regex';
    let reason = null;
    let methods = { methods: [] };
    try {
      const absolute = path.join(projectRoot, page.filePath.replace('/src/pages/', 'src/pages/'));
      const source = fs.readFileSync(absolute, 'utf8');
      const ast = await extractPageOptionsFromAst(source);
      if (ast === null) {
        // No parser available: keep the regex heuristic and say so.
        options = extractPageOptions(source);
        reason = 'Parsed with the regex fallback; install vite for exact AST extraction.';
      } else if (ast.method === 'ast') {
        options = { services: [], middlewares: 0, transport: null, ssg: null, ...ast.options,
          decoratorLine: ast.decoratorLine ?? null };
        method = 'ast';
      } else {
        method = 'unknown';
        reason = ast.reason ?? 'The @Page options could not be resolved statically.';
      }
      methods = await extractMethodClassificationsFromAst(source) ?? { methods: [], reason: 'The TypeScript parser is unavailable.' };
    } catch { /* unreadable source keeps null options; the route still lists */
      method = 'unknown';
      reason = 'The page source could not be read.';
    }
    pages.push({
      ...page,
      routeId: idFor(page.filePath),
      params: extractRouteParams(page.route),
      layouts: layoutStackForPage(page.filePath, layoutKeys),
      errorBoundary: nearestSpecialPage(page.filePath, model.pages, 'error'),
      notFoundBoundary: nearestSpecialPage(page.filePath, model.pages, '404'),
      transport: options.transport,
      ssg: options.ssg,
      middlewares: options.middlewares,
      services: options.services,
      serverMethods: methods.methods?.filter(entry => entry.kind === 'server') ?? [],
      clientMethods: methods.methods?.filter(entry => entry.kind !== 'server') ?? [],
      methodExtraction: { method: 'syntax', reason: methods.reason ?? null },
      extraction: { method, reason },
      // Source location of the @Page decorator for inspection output.
      source: options.decoratorLine
        ? `${page.filePath}:${options.decoratorLine}`
        : page.filePath,
    });
  }
  // Layouts declare the services their subtrees can inject: inspection
  // reports ownership exactly as DI resolution finds it.
  const layouts = [];
  for (const layout of model.layouts) {
    let options = { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
    let method = 'regex';
    let reason = null;
    try {
      const absolute = path.join(projectRoot, layout.filePath.replace('/src/pages/', 'src/pages/'));
      const source = fs.readFileSync(absolute, 'utf8');
      const ast = await extractPageOptionsFromAst(source);
      if (ast === null) {
        options = extractPageOptions(source);
        reason = 'Parsed with the regex fallback; install vite for exact AST extraction.';
      } else if (ast.method === 'ast') {
        options = { services: [], middlewares: 0, transport: null, ssg: null, ...ast.options,
          decoratorLine: ast.decoratorLine ?? null };
        method = 'ast';
      } else {
        method = 'unknown';
        reason = ast.reason ?? 'The @Page options could not be resolved statically.';
      }
    } catch {
      method = 'unknown';
      reason = 'The layout source could not be read.';
    }
    layouts.push({
      ...layout,
      services: options.services,
      extraction: { method, reason },
      source: options.decoratorLine ? `${layout.filePath}:${options.decoratorLine}` : layout.filePath,
    });
  }
  return { pages, layouts };
}
