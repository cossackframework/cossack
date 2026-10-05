import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '../fs-utils.js';
import { commandSpecs } from '../command-specs.js';
import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandFailure, writeResult } from '../output.js';
import { planResources, applyResourcePlan } from '../resource-plan.js';

export async function resourcesCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.resources, args, ctx, resourcesHelp)) return 0;
  if (!validateCommand(commandSpecs.resources, args, ctx)) return 1;
  try {
    const root = await findProjectRoot(ctx.cwd);
    let selections;
    if (ctx.flags.select) {
      const file = path.resolve(ctx.cwd, ctx.flags.select);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('Invalid selection file');
      selections = JSON.parse(await fs.readFile(file, 'utf8'));
    }
    const plan = await planResources(root, { accountId: ctx.flags.account, environment: ctx.flags.env,
      selections, verify: ctx.flags.verify === true || args[0] === 'apply' });
    const data = args[0] === 'apply' ? await applyResourcePlan(plan) : plan;
    if (ctx.flags.json) writeResult('resources', { data });
    else {
      console.log(`Resource ${args[0]}: account ${data.account.accountId}, environment ${data.environment ?? 'default'}`);
      for (const item of data.resources) console.log(`${item.binding}: ${item.mode} (${item.remote.status})${item.remote.action ? ` — ${item.remote.action}` : ''}`);
      console.log(`Cloud writes: 0; local writes: ${data.effects.localWrites}`);
    }
    return 0;
  } catch (error) {
    return commandFailure(ctx, 'resources', typeof error.code === 'string' && error.code.startsWith('COSSACK_RESOURCE_') ? error.code : 'COSSACK_RESOURCE_PLAN_FAILED',
      'Resource planning/application failed. Check the explicit account, environment, selection schema, installed Wrangler and unresolved actions. No cloud resource was created.');
  }
}
export function resourcesHelp() {
  return commandSpecs.resources.help(`cossack resources <plan|apply> --account <ACCOUNT_ID> [--env <ENV>] [--select <FILE>] [--verify] [--json]

Plan local binding ownership and unresolved actions without writing files.
--verify explicitly checks account access and supported existing references using
the project's Wrangler. Apply requires verification and edits only local JSON/JSONC.
No command creates or deletes cloud resources. Unsupported provisioning returns
an explicit action; TOML application requires manual edits.
Selections: {"schemaVersion":1,"resources":[{"binding":"DB","kind":"d1","mode":"existing","id":"<UUID>","name":"<DATABASE>"}]}.
See docs/cloudflare-resources.md for resource kinds and verification boundaries.`);
}
