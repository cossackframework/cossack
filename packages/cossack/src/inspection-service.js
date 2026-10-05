import { inspectWorkflows } from '@cossackframework/framework/workflows-inspection';
import { inspectSchedules } from '@cossackframework/framework/schedules-inspection';
/** Shared, output-free inspection used by CLI commands and local agent tools. */
import { buildEffectiveRouteModel } from './scan-routes.js';
import { inspectConfigurationRequirements } from './config-inspection.js';
import { inspectDeployment } from './deployment.js';
import { inspectProviders } from './providers-inspection.js';
import { inspectLocalization } from './localization-service.js';

/** Explain one route's effective behavior with reasons and source locations. */
export function explainRoute(effective, route) {
  const sourcePage = effective.pages.find(candidate => candidate.filePath === route);
  const publicPages = effective.pages.filter(candidate => candidate.route === route);
  const page = sourcePage ?? publicPages.find(candidate => candidate.kind !== '404' && candidate.kind !== 'error');
  if (!page && publicPages.length) {
    throw Object.assign(new Error(`Boundaries have source identities. Inspect one of: ${publicPages.map(candidate => candidate.filePath).join(', ')}`),
      { code: 'COSSACK_ROUTE_BOUNDARY_SOURCE_REQUIRED' });
  }
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
  if (page.transport === 'durable-object' && page.stateful === true) {
    reasons.push(`Durable page state: ${effective.runtime.capabilities?.durableState?.status ?? 'unknown'} on ${effective.runtime.name}. Process-local WebSockets alone do not persist state across restarts.`);
  }
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
    .filter(layout => layout && (layout.services.length ||
      layout.serviceOwnership?.status === 'resolved' && layout.serviceOwnership.services.length));
  for (const filePath of page.layouts) {
    const layout = effective.layouts.find(candidate => candidate.filePath === filePath);
    if (layout?.serviceOwnership?.status === 'unknown' &&
        (layout.services.length || layout.extraction.method === 'unknown')) {
      reasons.push(`Service ownership is unknown at ${filePath}: ${layout.serviceOwnership.reason}`);
    }
  }
  if (ownedServices.length) {
    const direct = ownedServices.filter(layout => layout.services.length);
    if (direct.length) reasons.push(`Layout service declarations: ${direct.map(layout => `${layout.services.join(', ')} (${layout.filePath})`).join('; ')}`);
    for (const layout of ownedServices) {
      if (layout.serviceOwnership?.status === 'resolved') {
        reasons.push(`TypeScript-source-resolved service class tokens: ${layout.serviceOwnership.services.map(service => `${service.className} (${service.source}:${service.line}; service decorator: ${service.serviceDecorator})`).join(', ')}; declared by ${layout.filePath}.`);
      } else {
        reasons.push(`Service class identity is unknown for ${layout.filePath}: ${layout.serviceOwnership?.reason ?? 'compiler facts are unavailable'}`);
      }
    }
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

export function checkRouteModel(effective) {
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
  return { ok, data, diagnostics };
}

/** Inspection performs no project-module execution, build, or remote operation. */
export async function inspectProject(root, { scope, environment = process.env.CLOUDFLARE_ENV, route, locale, check = false }) {
  if (scope === 'routes') {
    const effective = await buildEffectiveRouteModel(root, { environment });
    if (check) return checkRouteModel(effective);
    if (route !== undefined) {
      const explanation = explainRoute(effective, route);
      if (!explanation) throw Object.assign(new Error('No matching route. Inspect routes to list valid identities.'), { code: 'COSSACK_ROUTE_UNKNOWN' });
      return { ok: true, data: { scope, ...explanation }, diagnostics: [] };
    }
    return { ok: true, data: { scope, routes: effective.pages, layouts: effective.layouts, scaffold: effective.scaffold, runtime: effective.runtime }, diagnostics: [] };
  }
  if (scope === 'cloudflare') {
    const { summary, diagnostics } = await inspectDeployment(root, environment);
    const configurationRequirements = await inspectConfigurationRequirements(root, { environment, check: true });
    diagnostics.push(...configurationRequirements.diagnostics);
    const valid = !diagnostics.some(item => item.severity === 'error');
    return { ok: !check || valid, diagnostics, data: { scope, ...summary, configurationRequirements,
      readiness: { configuration: valid ? 'valid' : 'invalid', build: 'not-checked', remote: 'not-checked' } } };
  }
  if (scope === 'localization') {
    const report = await inspectLocalization(root, { locale });
    return { ok: !check || report.valid, data: { scope, ...report }, diagnostics: report.diagnostics };
  }
  if (scope === 'workflows') {
    const { diagnostics, ...data } = await inspectWorkflows(root, environment);
    return { ok: diagnostics.length === 0, data, diagnostics };
  }
  if (scope === 'schedules') {
    const { diagnostics, ...data } = await inspectSchedules(root, environment);
    return { ok: diagnostics.length === 0, data, diagnostics };
  }
  if (scope === 'providers') {
    const { diagnostics, ...data } = await inspectProviders(root, environment);
    return { ok: !check || !diagnostics.some(item => item.severity === 'error'), data, diagnostics };
  }
  throw Object.assign(new Error('Unknown inspection scope.'), { code: 'COSSACK_INSPECTION_SCOPE_UNKNOWN' });
}
