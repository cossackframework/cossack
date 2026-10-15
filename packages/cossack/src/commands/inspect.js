import { explainRoute, checkRouteModel, inspectProject, reservedPathDiagnostics } from '../inspection-service.js';
import { commandSpecs, inspectRoutesSpec } from '../command-specs.js';
import { findProjectRoot } from '../fs-utils.js';
import { inspectProviders } from '../providers-inspection.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';
import { buildEffectiveRouteModel } from '../scan-routes.js';
import { showCommandHelp, validateCommand, runWithSpec } from '../command-spec.js';

const routesSpec = inspectRoutesSpec;

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
    const { ok, data, diagnostics } = checkRouteModel(effective, await reservedPathDiagnostics(root));
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
    const environment = ctx.flags.env ?? process.env.CLOUDFLARE_ENV;
    const { ok, data, diagnostics } = await inspectProject(root, { scope: 'cloudflare', environment, check: command === 'check' });
    const summary = data;
    const valid = data.readiness.configuration === 'valid';
    if (ctx.flags.json === true) writeResult(command, { ok, data, diagnostics });
    else {
      console.log(`Worker: ${summary.worker ?? '(unnamed)'}\nEnvironment: ${summary.environment ?? '(default)'}\nConfig: ${summary.configPath}`);
      for (const binding of summary.bindings) {
        const reference = binding.resource ?? binding.className;
        const target = reference ? `${binding.referenceKind ?? 'class'} ${reference}` : 'no resource reference';
        const status = binding.configuration === 'unresolved'
          ? `needs setup: ${binding.nextAction}; remote existence/access not checked`
          : `${target}; remote existence/access not checked`;
        console.log(`${binding.name}: ${binding.type} (${status})`);
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

async function inspectProviderDeclarations(ctx, command) {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const { diagnostics, ...data } = await inspectProviders(root, ctx.flags.env ?? process.env.CLOUDFLARE_ENV);
    const valid = !diagnostics.some(item => item.severity === 'error');
    const ok = command === 'inspect' || valid;
    if (ctx.flags.json === true) writeResult(command, { ok, data, diagnostics });
    else {
      console.log(`Providers (${data.runtime}, ${data.environment ?? 'default'}): ${data.inspectionScope}`);
      console.log(`Cache default: ${data.cache.default.name ?? 'unknown'}`);
      const show = (label, capabilities) => console.log(`${label}: ${capabilities.provider}; durations=${capabilities.durationUnit}; locality=${capabilities.locality}; persistence=${capabilities.persistence}; consistency=${capabilities.consistency}; atomicIncrement=${capabilities.atomicIncrement}; expiry=${capabilities.expiryPrecision}`);
      for (const store of data.cache.stores) show(`Cache ${store.name}`, store.capabilities);
      show('Rate limit', data.rateLimit.capabilities);
      for (const diagnostic of diagnostics) console.error(`${diagnostic.code}: ${diagnostic.message}`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
    return commandFailure(ctx, command, code, diagnosticMessage(error, code));
  }
}

export function inspectCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.inspect, args, ctx, inspectHelp)) return 0;
  if (!validateCommand(commandSpecs.inspect, args, ctx)) return 1;
  if (args[0] === 'workflows') return inspectWorkflowDeclarations(ctx, 'inspect');
  if (args[0] === 'schedules') return inspectScheduleDeclarations(ctx, 'inspect');
  if (args[0] === 'providers') return inspectProviderDeclarations(ctx, 'inspect');
  if (args[0] === 'routes') {
    return runWithSpec(routesSpec, args.slice(1), ctx, () => inspectRoutes(args.slice(1), ctx, 'inspect'));
  }
  return inspectCloudflare(args, ctx, 'inspect');
}
export function checkCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.check, args, ctx, checkHelp)) return 0;
  if (!validateCommand(commandSpecs.check, args, ctx)) return 1;
  if (args[0] === 'workflows') return inspectWorkflowDeclarations(ctx, 'check');
  if (args[0] === 'schedules') return inspectScheduleDeclarations(ctx, 'check');
  if (args[0] === 'providers') return inspectProviderDeclarations(ctx, 'check');
  if (args[0] === 'routes') return checkRoutes(ctx);
  return inspectCloudflare(args, ctx, 'check');
}

export function inspectHelp() {
  return commandSpecs.inspect.help(`cossack inspect <cloudflare|routes|providers|schedules|workflows> [route]

Read the project's resolved Worker, environment, bindings, required secret
names, and configuration diagnostics. Inspection succeeds when configuration
can be read, even if diagnostics identify deployment errors.
No builds, generated files, resource provisioning, or cloud requests.
Binding summaries distinguish configured references from unresolved setup and
mark remote existence/access as not checked.
Use cossack check cloudflare for a failing exit code on invalid configuration.
Use cossack inspect routes to list effective routes, or supply a route to
explain its options, layout ancestry, methods, and source locations.
Use cossack inspect providers for declared cache/limiter backends, millisecond
units, locality, persistence, consistency, atomicity and supported operations.
Dynamic configuration/overrides remain unknown; modules are never executed.`);
}

export function checkHelp() {
  return commandSpecs.check.help(`cossack check <cloudflare|routes|providers|schedules|workflows> [--json]

Validate local Cloudflare deployment configuration (--env <name>) or static
route metadata without writing files. --env selects Cloudflare configuration
for either scope. Route checks fail on missing/unresolved default class exports,
unknown options, ignored page service declarations, routes at reserved paths
(COSSACK_TRANSPORT_ROUTE_RESERVED for /crpc, /upload, /sse/ and /ws/;
COSSACK_ASSETS_NAMESPACE_RESERVED for /assets/ and public/assets/, as the
build and deploy preflight report them),
unavailable compiler method facts, invalid/unsupported transports, or missing
required transport bindings. Inherited behavior
and runtime execution are not yet checked.
Returns a nonzero exit code for configuration errors. Build artifacts,
remote resources, permissions, and secret availability are not checked.
--json emits one versioned result with resource names and diagnostics.
Binding entries distinguish configured references from unresolved setup and mark
remote existence/access as not checked. A configured name or ID does not prove
that the resource exists or is available in the selected account.
Provider checks validate declared cache requirements, binding names and limiter
selection. They do not verify process/secret overrides or remote readiness.`);
}

async function inspectScheduleDeclarations(ctx, command) {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await inspectProject(root, { scope: 'schedules', environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV, check: command === 'check' });
    if (ctx.flags.json === true) writeResult(command, result);
    else {
      for (const item of result.data.schedules) console.log(`${item.name}: ${item.cron} (UTC) -> ${item.job}`);
      for (const item of result.diagnostics) console.error(`${item.code}: ${item.message}`);
      console.log('Static schedule declarations only; handlers and remote execution were not checked.');
    }
    return result.ok ? 0 : 1;
  } catch { return commandFailure(ctx, command, 'COSSACK_SCHEDULES_INVALID', 'Schedule inspection failed. Check src/schedules.json and scheduler declarations.'); }
}

async function inspectWorkflowDeclarations(ctx, command) {
  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await inspectProject(root, { scope: 'workflows', environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV, check: command === 'check' });
    if (ctx.flags.json === true) writeResult(command, result);
    else {
      for (const item of result.data.workflows) console.log(`${item.name} v${item.version}: ${item.binding} -> ${item.className}`);
      for (const item of result.diagnostics) console.error(`${item.code}: ${item.message}`);
      console.log('Static workflow declarations only; entry execution and remote readiness were not checked.');
    }
    return result.ok ? 0 : 1;
  } catch { return commandFailure(ctx, command, 'COSSACK_WORKFLOWS_INVALID', 'Workflow inspection failed. Check src/workflows.json and selected bindings.'); }
}
