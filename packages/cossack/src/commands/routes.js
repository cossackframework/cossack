import path from 'node:path';
import { buildRouteModel, layoutStackForPage } from '../scan-routes.js';
import { findProjectRoot } from '../fs-utils.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({ name: 'routes', flags: { verbose: { type: 'boolean' } } });

export async function routesCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
  const root = await findProjectRoot(ctx.cwd);
  const model = buildRouteModel(root);

  if (model.pages.length === 0 && model.layouts.length === 0) {
    if (ctx.flags.json === true) return { routes: [], pages: 0, layouts: 0 };
    console.log('No routes found under src/pages/.');
    return null;
  }

  const pagesByRoute = new Map();
  for (const p of model.pages) {
    if (!pagesByRoute.has(p.route)) pagesByRoute.set(p.route, []);
    pagesByRoute.get(p.route).push(p);
  }

  const layoutKeys = model.layouts.map((l) => l.filePath);

  const method = (kind) =>
    kind === '404' ? '404' : kind === 'error' ? 'ERR' : kind === 'api' ? 'API' : 'GET';

  const routes = [...pagesByRoute.keys()].sort();
  for (const route of routes) {
    const group = pagesByRoute.get(route);
    for (const page of group) {
      console.log(formatRow(method(page.kind), route, page.filePath));
    }
    // show layout stack for the first page on this route
    const layouts = layoutStackForPage(group[0].filePath, layoutKeys);
    for (const lp of layouts) {
      console.log(formatRow('LAYOUT', '  \u2514 layout', lp));
    }
  }

  // orphan layouts (no page in their subtree) — surface them too
  const usedLayouts = new Set();
  for (const page of model.pages) {
    for (const lp of layoutStackForPage(page.filePath, layoutKeys)) {
      usedLayouts.add(lp);
    }
  }
  for (const l of model.layouts) {
    if (!usedLayouts.has(l.filePath)) {
      console.log(formatRow('LAYOUT', '(orphan)', l.filePath));
    }
  }

  if (ctx.flags.json === true) {
    return {
      routes: model.pages.map(page => ({
        kind: page.kind,
        route: page.route,
        filePath: page.filePath,
        layouts: layoutStackForPage(page.filePath, layoutKeys),
      })),
      pages: model.pages.length,
      layouts: model.layouts.length,
    };
  }
  if (ctx.flags.verbose) {
    console.log(`\n${model.pages.length} page(s), ${model.layouts.length} layout(s).`);
  }
  return null;
  });
}

function formatRow(method, route, filePath) {
  const m = String(method).padEnd(6);
  const r = String(route).padEnd(28);
  return `${m}${r}${filePath}`;
}

export function routesHelp() {
  return `cossack routes

List all routes discovered under src/pages/.

Options:
  --verbose   Show counts and extra detail.`;
}
