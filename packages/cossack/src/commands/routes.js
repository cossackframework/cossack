import { commandSpecs } from '../command-specs.js';
import { generateRoutes } from '@cossackframework/framework/route-codegen';
import { buildRouteModel, buildEffectiveRouteModel, layoutStackForPage } from '../scan-routes.js';
import { findProjectRoot } from '../fs-utils.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.routes;

export async function routesCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
  const root = await findProjectRoot(ctx.cwd);
  // Effective metadata (RT-07): params, layout ancestry, boundaries, and
  // source-level @Page options come from the effective model; the compact
  // model still drives the human table.
  const effective = await buildEffectiveRouteModel(root, { environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV, includeMarkdown: ctx.flags.markdown });
  const model = buildRouteModel(root, effective.discovery);
  let generation;
  if (ctx.flags.generate === true) {
    const dryRun = ctx.dryRun === true;
    const result = generateRoutes(root, { ...effective.discovery, write: !dryRun });
    generation = { file: '.cossack/routes.ts', changed: result.changed, written: !dryRun && result.changed, dryRun };
    if (ctx.flags.json !== true) console.log(`${dryRun ? 'Would generate' : 'Generated'} .cossack/routes.ts`);
  }


  if (ctx.flags.json === true) {
    return { routes: effective.pages, pages: effective.pages.length, layouts: effective.layouts.length, scaffold: effective.scaffold, runtime: effective.runtime, manifest: effective.manifest, discovery: effective.discovery, ...(generation ? { generation } : {}) };
  }

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

  if (ctx.flags.verbose) {
    for (const page of effective.pages) {
      if (page.params.length) {
        console.log(formatRow('PARAM', page.route, page.params.map(p => p.name + (p.catchAll ? '*' : '')).join(', ')));
      }
    }
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
  return commandSpecs.routes.help(`cossack routes

List all routes discovered under src/pages/.
Use --generate to emit typed URLs before a standalone TypeScript check.`);
}
