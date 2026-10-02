import { findProjectRoot } from '../fs-utils.js';
import { inspectDeployment } from '../deployment.js';
import { commandFailure, writeResult } from '../output.js';

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

export function inspectCommand(args, ctx) { return inspectCloudflare(args, ctx, 'inspect'); }
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
