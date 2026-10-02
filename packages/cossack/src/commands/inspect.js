import { commandSpecs, inspectRoutesSpec } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { inspectDeployment } from '../deployment.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';
import { buildEffectiveRouteModel } from '../scan-routes.js';
import { showCommandHelp, validateCommand, runWithSpec } from '../command-spec.js';

const routesSpec = inspectRoutesSpec;

/** Explain one route's effective behavior with reasons and source locations. */
function explainRoute(effective, route) {
  const page = effective.pages.find(candidate => candidate.route === route);
  if (!page) return null;
  const reasons = [];
  if (page.routeStyle === 'http-handlers') reasons.push('Functional HTTP handlers use HTTP routing; component decorators, RPC method classification, and layout scopes do not apply.');
  else reasons.push(`Default export: ${page.moduleExport.status}. ${page.moduleExport.reason}`);
  const capability = effective.runtime.transports.find(item => item.source === page.source);
  if (capability) {
    reasons.push(`Runtime ${effective.runtime.name}: ${capability.transport} transport is ${capability.status} (configured binding presence only).`);
    if (capability.missingBindings.length) reasons.push(`Missing transport bindings: ${capability.missingBindings.join(', ')}`);
  } else reasons.push('Runtime transport capability is unknown.');

  if (page.routeStyle !== 'http-handlers') reasons.push(page.extraction.method === 'unknown'
    ? `Transport and options are unknown: ${page.extraction.reason} (${page.source})`
    : `Transport "${page.transport ?? 'http'}": set by the @Page decorator at ${page.source}`
      + (page.transport ? '' : ' (no explicit transport; http is the default)'));
  if (page.layouts.length) {
    reasons.push(`Layout ancestry (${page.layouts.length}): ${page.layouts.join(' -> ')}`);
  } else {
    reasons.push('Layout ancestry: none (no layout.ts on the path from src/pages)');
  }
  reasons.push(`Layout/page middleware order (global bootstrap middleware excluded): ${page.middlewareStack.map(entry => `${entry.source}: ${entry.count ?? 'unknown'}`).join(' -> ')}`);
  if (page.middlewares > 0) {
    reasons.push(`${page.middlewares} middleware(s) declared on the page's @Page options at ${page.source}`);
  }
  if (page.ssg !== null) reasons.push(`SSG ${page.ssg ? 'enabled' : 'disabled'} by @Page({ ssg: ${page.ssg} })`);
  if (page.params.length) {
    reasons.push(`Parameters: ${page.params.map(param => param.name + (param.catchAll ? ' (catch-all)' : '')).join(', ')}`);
  }
  const ownedServices = page.layouts
    .map(filePath => effective.layouts.find(layout => layout.filePath === filePath))
    .filter(layout => layout && layout.services.length);
  for (const filePath of page.layouts) {
    const layout = effective.layouts.find(candidate => candidate.filePath === filePath);
    if (layout?.extraction.method === 'unknown') reasons.push(`Service ownership is unknown at ${filePath}: ${layout.extraction.reason}`);
  }
  if (ownedServices.length) {
    reasons.push(`Layout service declarations (source expressions, token identity not resolved): ${ownedServices.map(layout => `${layout.services.join(', ')} (${layout.filePath})`).join('; ')}`);
  }
  if (page.services.length) {
    reasons.push(`Services declared on the page itself are not owned at runtime: ${page.services.join(', ')}. Move these declarations to an ancestor layout's @Page({ services: [...] }).`);
  }
  if (page.serverMethods?.length) {
    reasons.push(`Server methods (RPC proxies on the client): ${page.serverMethods.map(entry => `${entry.name} (${entry.reason})`).join('; ')}`);
  }
  if (page.clientMethods?.length) {
    reasons.push(`Client/shared methods (no transport): ${page.clientMethods.map(entry => entry.name).join(', ')}`);
  }
  for (const base of page.inheritedDeclarations ?? []) {
    reasons.push(`Base declarations from ${base.className}: ${base.methods.map(method => `${method.name} (${method.reason})`).join('; ')}`);
  }
  if (page.routeStyle !== 'http-handlers' && page.inheritance?.status === 'unresolved') reasons.push('Base declarations are unresolved; inherited behavior is unknown.');
  if (page.routeStyle !== 'http-handlers' && page.methodExtraction?.reason) reasons.push(`Method classification: ${page.methodExtraction.reason}`);
  if (page.notFoundBoundary) reasons.push(`Nearest 404 boundary: ${page.notFoundBoundary}`);
  if (page.errorBoundary) reasons.push(`Nearest error boundary: ${page.errorBoundary}`);
  return { route: page.route, routeId: page.routeId, kind: page.kind, source: page.source, reasons };
}

async function inspectRoutes(args, ctx, command) {
  const [target] = args;
  if (!target) {
    const root = await findProjectRoot(ctx.cwd);
    const effective = await buildEffectiveRouteModel(root, { environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV });
    if (ctx.flags.json === true) {
      return { scope: 'routes', routes: effective.pages, layouts: effective.layouts, scaffold: effective.scaffold, runtime: effective.runtime };
    }
    for (const page of effective.pages) {
      console.log(`${page.route.padEnd(34)} ${String(page.transport ?? 'http').padEnd(15)} ${page.source}`);
    }
    const owned = effective.layouts.filter(layout => layout.services.length);
    if (owned.length) {
      console.log('\nService ownership (layout -> declared services):');
      for (const layout of owned) console.log(`  ${layout.filePath} -> ${layout.services.join(', ')}`);
    }
    return 0;
  }
  // `inspect routes <route>` / `explain <route>`: facts with reasons.
  const root = await findProjectRoot(ctx.cwd);
  const effective = await buildEffectiveRouteModel(root, { environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV });
  const explanation = explainRoute(effective, target);
  if (!explanation) {
    throw Object.assign(new Error(`No route matches '${target}'. Run cossack inspect routes to list routes.`),
      { code: 'COSSACK_ROUTE_UNKNOWN' });
  }
  if (ctx.flags.json === true) {
    return { scope: 'routes', ...explanation };
  }
  console.log(`Route ${explanation.route} (${explanation.kind}) — ${explanation.source}`);
  for (const reason of explanation.reasons) console.log(`  - ${reason}`);
  return 0;
}

/** Validate statically available route facts; never execute project modules. */
async function checkRoutes(ctx) {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const effective = await buildEffectiveRouteModel(root, { environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV });
    const diagnostics = [...effective.scaffold.diagnostics, ...effective.runtime.diagnostics];
    const add = (code, message, source) => diagnostics.push({ code, severity: 'error', message, source });
    for (const item of [...effective.pages, ...effective.layouts]) {
      if (item.routeStyle === 'http-handlers') continue;
      if (item.moduleExport.status !== 'resolved') {
        add(item.moduleExport.status === 'missing' ? 'COSSACK_ROUTE_DEFAULT_EXPORT_MISSING' : 'COSSACK_ROUTE_DEFAULT_EXPORT_UNKNOWN',
          item.moduleExport.reason, item.source);
      }
      if (item.extraction.method !== 'ast') {
        add('COSSACK_ROUTE_OPTIONS_UNKNOWN', 'Route options could not be resolved statically.', item.source);
      }
    }
    for (const page of effective.pages) {
      if (page.routeStyle === 'http-handlers') continue;
      if (page.services.length) {
        add('COSSACK_PAGE_SERVICES_UNSUPPORTED', 'Pages do not create service scopes. Move services to an ancestor layout\'s @Page({ services: [...] }).', page.source);
      }
      if (page.declarationDispatch.status === 'unknown') {
        add('COSSACK_ROUTE_DISPATCH_UNKNOWN', 'Declared member precedence could not be resolved statically.', page.source);
      }
      if (page.inheritance.status === 'unresolved') {
        add('COSSACK_ROUTE_INHERITANCE_UNKNOWN', 'Base declarations could not be resolved statically.', page.source);
      }
      if (page.methodExtraction.method !== 'compiler') {
        add('COSSACK_ROUTE_METHODS_UNKNOWN', 'Own-method compiler classification is unavailable.', page.source);
      }
      if (page.transport !== null && !['http', 'sse', 'websocket', 'durable-object'].includes(page.transport)) {
        add('COSSACK_ROUTE_TRANSPORT_INVALID', 'Route transport must be http, sse, websocket, or durable-object.', page.source);
      }
    }
    const ok = diagnostics.length === 0;
    const data = {
      scope: 'routes', routes: effective.pages, layouts: effective.layouts, scaffold: effective.scaffold, runtime: effective.runtime,
      readiness: { staticMetadata: ok ? 'valid' : 'invalid', inheritance: 'not-checked', runtime: 'not-checked' },
    };
    if (ctx.flags.json === true) writeResult('check', { ok, data, diagnostics });
    else {
      for (const diagnostic of diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message} (${diagnostic.source})`);
      console.log(`Static route metadata: ${ok ? 'valid' : 'invalid'}. Inheritance and runtime behavior were not checked.`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
    return commandFailure(ctx, 'check', code,
      ctx.flags.json === true ? diagnosticMessage(error, code) : error.message);
  }
}

async function inspectCloudflare(args, ctx, command) {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const { summary, diagnostics } = await inspectDeployment(root, ctx.flags.env ?? process.env.CLOUDFLARE_ENV);
    const valid = !diagnostics.some(item => item.severity === 'error');
    const ok = command === 'inspect' || valid;
    const data = { scope: 'cloudflare', ...summary,
      readiness: { configuration: valid ? 'valid' : 'invalid', build: 'not-checked', remote: 'not-checked' } };
    if (ctx.flags.json === true) writeResult(command, { ok, data, diagnostics });
    else {
      console.log(`Worker: ${summary.worker ?? '(unnamed)'}\nEnvironment: ${summary.environment ?? '(default)'}\nConfig: ${summary.configPath}`);
      for (const binding of summary.bindings) {
        console.log(`${binding.name}: ${binding.type} (${binding.resource ?? binding.className ?? binding.provisioning ?? 'configured'})`);
      }
      console.log(`Required secrets: ${summary.requiredSecrets.join(', ') || '(none declared)'}`);
      for (const diagnostic of diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
      console.log(`Local configuration: ${valid ? 'valid' : 'invalid'}. Build and remote readiness were not checked.`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
    return commandFailure(ctx, command, code,
      ctx.flags.json === true ? diagnosticMessage(error, code) : error.message);
  }
}

export function inspectCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.inspect, args, ctx, inspectHelp)) return 0;
  if (!validateCommand(commandSpecs.inspect, args, ctx)) return 1;
  if (args[0] === 'routes') {
    return runWithSpec(routesSpec, args.slice(1), ctx, () => inspectRoutes(args.slice(1), ctx, 'inspect'));
  }
  return inspectCloudflare(args, ctx, 'inspect');
}
export function checkCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.check, args, ctx, checkHelp)) return 0;
  if (!validateCommand(commandSpecs.check, args, ctx)) return 1;
  if (args[0] === 'routes') return checkRoutes(ctx);
  return inspectCloudflare(args, ctx, 'check');
}

export function inspectHelp() {
  return commandSpecs.inspect.help(`cossack inspect <cloudflare|routes> [route]

Read the project's resolved Worker, environment, bindings, required secret
names, and configuration diagnostics. Inspection succeeds when configuration
can be read, even if diagnostics identify deployment errors.
No builds, generated files, resource provisioning, or cloud requests.
Use cossack check cloudflare for a failing exit code on invalid configuration.
Use cossack inspect routes to list effective routes, or supply a route to
explain its options, layout ancestry, methods, and source locations.`);
}

export function checkHelp() {
  return commandSpecs.check.help(`cossack check <cloudflare|routes> [--json]

Validate local Cloudflare deployment configuration (--env <name>) or static
route metadata without writing files. --env selects Cloudflare configuration
for either scope. Route checks fail on missing/unresolved default class exports,
unknown options, ignored page service declarations,
unavailable compiler method facts, invalid/unsupported transports, or missing
required transport bindings. Inherited behavior
and runtime execution are not yet checked.
Returns a nonzero exit code for configuration errors. Build artifacts,
remote resources, permissions, and secret availability are not checked.
--json emits one versioned result with resource names and diagnostics.`);
}
