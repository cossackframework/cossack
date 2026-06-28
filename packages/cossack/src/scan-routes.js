import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure route derivation replicated from the framework router
 * (packages/framework/src/router.ts, route-registration loop):
 *
 *   route = filePath
 *     .replace('/src/pages', '')
 *     .replace(/\.(ts|tsx|js|jsx|md|mdx)$/, '')
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
    .replace(/\.(ts|tsx|js|jsx|md|mdx)$/, '')
    .replace(/\/index$/, '')
    .replace(/\/\([^)]+\)/g, '')
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

  const pages = pageKeys.map((filePath) => {
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
