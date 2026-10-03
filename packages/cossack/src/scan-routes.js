import { inspectRuntimeMetadata } from './runtime-metadata.js';
import { resolveDeclarationDispatch } from './member-dispatch.js';
import { resolveImportedInheritance } from './inheritance.js';
import { inspectScaffoldMetadata } from './project-metadata.js';
import fs from 'node:fs';
import path from 'node:path';
import { extractMethodClassificationsFromAst } from './page-options-ast.js';
import { extractPageOptionsFromAst, inspectDefaultClassExport, isHttpHandlerModule } from './page-options-ast.js';
import { filePathToHttpRoute, classifyRoute, resolveLayoutPaths, resolveNearestSpecialPage, routeParameters } from '@cossackframework/framework/route-ids';
import { discoverRoutes, scanPagesDir } from '@cossackframework/framework/route-codegen';
export { filePathToHttpRoute, classifyRoute, scanPagesDir };


/** Directory scope of a path, e.g. /src/pages/(auth)/login/index.ts -> /(auth)/login */
function dirScope(filePath) {
  const rel = filePath.replace('/src/pages/', '');
  const parts = rel.split('/');
  parts.pop(); // drop filename
  return '/src/pages/' + parts.join('/');
}

/**
 * Build the route model used by `cossack routes`.
 * pages:  [{ filePath, route, kind }]
 * layouts: [{ filePath, scope }]
 */
export function buildRouteModel(projectRoot, options = {}) {
  const manifest = discoverRoutes(projectRoot, options.includeMarkdown ?? false);
  const pages = manifest.routes.map(descriptor => ({
    filePath: descriptor.filePath, route: descriptor.pattern, kind: descriptor.kind,
    name: descriptor.name, routeId: descriptor.routeId, params: descriptor.parameters,
    layoutPaths: descriptor.layoutPaths, errorBoundary: descriptor.errorBoundary,
    notFoundBoundary: descriptor.notFoundBoundary, addressable: descriptor.addressable,
  }));
  const layouts = manifest.layoutKeys.map(filePath => ({ filePath, scope: dirScope(filePath), routeId: manifest.filePathToId[filePath] }));
  return { pages, layouts, manifest };
}

export const layoutStackForPage = resolveLayoutPaths;
export const extractRouteParams = routeParameters;


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
  return resolveNearestSpecialPage(pageFilePath, pages.map(page => page.filePath), type);
}

/**
 * Effective route metadata model (RT-07): per page, the URL, stable route id
 * (same index-based computation as the runtime's computeRouteIds), dynamic
 * parameters, layout ancestry, nearest 404/error boundaries, and source-level
 * @Page options. Inspection reads facts; it never executes components.
 */
export async function buildEffectiveRouteModel(projectRoot, options = {}) {
  const scaffold = await inspectScaffoldMetadata(projectRoot);
  const includeMarkdown = options.includeMarkdown ?? scaffold.recipe?.features?.some(feature => feature.name === 'markdown') ?? false;
  const model = buildRouteModel(projectRoot, { includeMarkdown });
  const layoutKeys = model.layouts.map((layout) => layout.filePath);
  const idFor = filePath => model.manifest.filePathToId[filePath] ?? null;
  const pages = [];
  for (const page of model.pages) {
    let options = { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
    let moduleExport = { status: 'unknown', reason: 'The source could not be read.' };
    let method = 'unknown';
    let reason = null;
    let methods = { methods: [] };
    let routeStyle = 'component';
    try {
      const absolute = path.join(projectRoot, page.filePath.replace('/src/pages/', 'src/pages/'));
      const source = fs.readFileSync(absolute, 'utf8');
      if (page.kind === 'api' && await isHttpHandlerModule(source)) routeStyle = 'http-handlers';
      moduleExport = await inspectDefaultClassExport(source);
      const ast = await extractPageOptionsFromAst(source);
      if (ast === null) {
        reason = 'The TypeScript parser is unavailable; route options are unknown.';
      } else if (ast.method === 'ast') {
        options = { services: [], middlewares: 0, transport: null, ssg: null, ...ast.options,
          decoratorLine: ast.decoratorLine ?? null };
        method = 'ast';
      } else {
        method = 'unknown';
        reason = ast.reason ?? 'The @Page options could not be resolved statically.';
      }
      methods = await extractMethodClassificationsFromAst(source, page.filePath, absolute) ?? { methods: [], reason: 'The TypeScript parser is unavailable.' };
      methods = await resolveImportedInheritance(source, absolute, page.filePath, methods);
    } catch { /* unreadable source keeps null options; the route still lists */
      method = 'unknown';
      reason = 'The page source could not be read.';
    }
    if (routeStyle === 'http-handlers') {
      options = { transport: 'http', ssg: null, middlewares: 0, services: [], decoratorLine: null };
      method = 'ast';
      reason = 'Functional HTTP handler module; component metadata does not apply.';
      methods = { methods: [], method: 'not-applicable', reason, inheritance: { status: 'not-applicable', bases: [] } };
    }
    pages.push({
      ...page,
      routeStyle,
      routeId: idFor(page.filePath),
      params: page.params,
      layouts: routeStyle === 'http-handlers' ? [] : layoutStackForPage(page.filePath, layoutKeys),
      errorBoundary: page.errorBoundary,
      notFoundBoundary: page.notFoundBoundary,
      transport: options.transport,
      stateful: options.stateful ?? null,
      ssg: options.ssg,
      middlewares: options.middlewares,
      services: options.services,
      serverMethods: methods.methods?.filter(entry => entry.kind === 'server') ?? [],
      clientMethods: methods.methods?.filter(entry => entry.kind === 'client') ?? [],
      strippedMethods: methods.methods?.filter(entry => entry.kind === 'stripped') ?? [],
      declarationDispatch: routeStyle === 'http-handlers'
        ? { status: 'not-applicable', scope: 'Functional HTTP handlers do not use component dispatch.', members: [] }
        : resolveDeclarationDispatch(methods, page.filePath),
      members: methods.members ?? [],
      inheritance: methods.inheritance ?? { status: 'unresolved', bases: [] },
      inheritedDeclarations: methods.inheritedDeclarations ?? [],
      methodExtraction: { method: methods.method ?? 'unknown', reason: methods.reason ?? null },
      moduleExport,
      extraction: { method, reason },
      // Source location of the @Page decorator for inspection output.
      source: options.decoratorLine
        ? `${page.filePath}:${options.decoratorLine}`
        : page.filePath,
    });
  }
  // Layouts declare service ownership for their subtrees. Keep source
  // expressions here; equal names do not prove equal runtime service tokens.
  const layouts = [];
  for (const layout of model.layouts) {
    let options = { transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null };
    let moduleExport = { status: 'unknown', reason: 'The source could not be read.' };
    let method = 'unknown';
    let reason = null;
    try {
      const absolute = path.join(projectRoot, layout.filePath.replace('/src/pages/', 'src/pages/'));
      const source = fs.readFileSync(absolute, 'utf8');
      moduleExport = await inspectDefaultClassExport(source);
      const ast = await extractPageOptionsFromAst(source);
      if (ast === null) {
        reason = 'The TypeScript parser is unavailable; route options are unknown.';
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
      middlewares: method === 'ast' ? options.middlewares : null,
      services: options.services,
      moduleExport,
      extraction: { method, reason },
      source: options.decoratorLine ? `${layout.filePath}:${options.decoratorLine}` : layout.filePath,
    });
  }
  for (const page of pages) {
    page.middlewareStack = [
      ...page.layouts.map(filePath => {
        const layout = layouts.find(candidate => candidate.filePath === filePath);
        return { source: layout?.source ?? filePath, count: layout?.middlewares ?? null };
      }),
      { source: page.source, count: page.extraction.method === 'ast' ? page.middlewares : null },
    ];
    page.layoutAndPageMiddlewareCount = page.middlewareStack.every(entry => entry.count !== null)
      ? page.middlewareStack.reduce((total, entry) => total + entry.count, 0) : null;
  }
  return { pages, layouts, scaffold, manifest: model.manifest, discovery: { includeMarkdown }, runtime: await inspectRuntimeMetadata(projectRoot, pages, options.environment,
    scaffold.recipe?.capabilityRequirements?.web ?? []) };
}
