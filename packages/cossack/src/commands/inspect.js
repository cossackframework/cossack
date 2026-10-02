import { findProjectRoot } from '../fs-utils.js';
import { inspectDeployment } from '../deployment.js';
import { commandFailure, writeResult } from '../output.js';
import { buildEffectiveRouteModel } from '../scan-routes.js';

/** Explain one route's effective behavior with reasons and source locations. */
function explainRoute(effective, route) {
  const page = effective.pages.find(candidate => candidate.route === route)
    ?? effective.pages.find(candidate => candidate.route.split('/:')[0] === route.split('/:')[0]);
  if (!page) return null;
  const reasons = [];
  reasons.push(`Transport "${page.transport ?? 'http'}": set by the @Page decorator at ${page.source}`
    + (page.transport ? '' : ' (no explicit transport; http is the default)'));
  if (page.layouts.length) {
    reasons.push(`Layout ancestry (${page.layouts.length}): ${page.layouts.join(' -> ')}`);
  } else {
    reasons.push('Layout ancestry: none (no layout.ts on the path from src/pages)');
  }
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
  if (ownedServices.length) {
    reasons.push(`Injectable services (owned by ancestry): ${ownedServices.map(layout => `${layout.services.join(', ')} (${layout.filePath})`).join('; ')}`);
  }
  if (page.services.length) {
    reasons.push(`Services declared on the page itself: ${page.services.join(', ')}`);
  }
  if (page.notFoundBoundary) reasons.push(`Nearest 404 boundary: ${page.notFoundBoundary}`);
  if (page.errorBoundary) reasons.push(`Nearest error boundary: ${page.errorBoundary}`);
  return { route: page.route, routeId: page.routeId, kind: page.kind, source: page.source, reasons };
}

async function inspectRoutes(args, ctx, command) {
  const [target] = args;
  if (!target) {
    const root = await findProjectRoot(ctx.cwd);
    const effective = buildEffectiveRouteModel(root);
    if (ctx.flags.json === true) {
      writeResult(command, { ok: true, data: { scope: 'routes', routes: effective.pages, layouts: effective.layouts } });
    } else {
      for (const page of effective.pages) {
        console.log(`${page.route.padEnd(34)} ${String(page.transport ?? 'http').padEnd(15)} ${page.source}`);
      }
      const owned = effective.layouts.filter(layout => layout.services.length);
      if (owned.length) {
        console.log('\nService ownership (layout -> declared services):');
        for (const layout of owned) console.log(`  ${layout.filePath} -> ${layout.services.join(', ')}`);
      }
    }
    return 0;
  }
  // `inspect routes <route>` / `explain <route>`: facts with reasons.
  const root = await findProjectRoot(ctx.cwd);
  const effective = buildEffectiveRouteModel(root);
  const explanation = explainRoute(effective, target);
  if (!explanation) {
    return commandFailure(ctx, command, 'COSSACK_ROUTE_UNKNOWN',
      `No route matches '${target}'. Run cossack inspect routes to list routes.`);
  }
  if (ctx.flags.json === true) {
    writeResult(command, { ok: true, data: { scope: 'routes', ...explanation } });
  } else {
    console.log(`Route ${explanation.route} (${explanation.kind}) — ${explanation.source}`);
    for (const reason of explanation.reasons) console.log(`  - ${reason}`);
  }
  return 0;
}

async function inspectCloudflare(args, ctx, command) {
  if (args.length !== 1 || args[0] !== 'cloudflare') {
    return commandFailure(ctx, command, 'COSSACK_INSPECTION_SCOPE_INVALID',
      `Use cossack ${command} cloudflare to inspect Cloudflare configuration.`);
  }
  for (const name of Object.keys(ctx.flags)) {
    if (!['env', 'json', 'help', 'h'].includes(name)) {
      return commandFailure(ctx, command, 'COSSACK_OPTION_UNKNOWN', `Unknown ${command} option --${name}.`);
    }
  }
  if (ctx.flags.env !== undefined && (typeof ctx.flags.env !== 'string' || !ctx.flags.env.trim())) {
    return commandFailure(ctx, command, 'COSSACK_OPTION_VALUE_REQUIRED', '--env requires one nonempty value.');
  }
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
    return commandFailure(ctx, command, error.code ?? 'COSSACK_INSPECTION_FAILED', error.message);
  }
}

export function inspectCommand(args, ctx) {
  if (args[0] === 'routes') return inspectRoutes(args.slice(1), ctx, 'inspect');
  return inspectCloudflare(args, ctx, 'inspect');
}
export function checkCommand(args, ctx) { return inspectCloudflare(args, ctx, 'check'); }

export function inspectHelp() {
  return `cossack inspect cloudflare [--env <name>] [--json]

Read the project's resolved Worker, environment, bindings, required secret
names, and configuration diagnostics. Inspection succeeds when configuration
can be read, even if diagnostics identify deployment errors.
No builds, generated files, resource provisioning, or cloud requests.
Use cossack check cloudflare for a failing exit code on invalid configuration.`;
}

export function checkHelp() {
  return `cossack check cloudflare [--env <name>] [--json]

Validate local Cloudflare deployment configuration without writing files.
Returns a nonzero exit code for configuration errors. Build artifacts,
remote resources, permissions, and secret availability are not checked.
--json emits one versioned result with resource names and diagnostics.`;
}
