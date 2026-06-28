import path from 'node:path';
import { buildRouteModel, layoutStackForPage } from '../scan-routes.js';
import { findProjectRoot } from '../fs-utils.js';

export async function routesCommand(args, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const model = buildRouteModel(root);

  if (model.pages.length === 0 && model.layouts.length === 0) {
    console.log('No routes found under src/pages/.');
    return 0;
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

  if (ctx.flags.verbose) {
    console.log(`\n${model.pages.length} page(s), ${model.layouts.length} layout(s).`);
  }
  return 0;
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
