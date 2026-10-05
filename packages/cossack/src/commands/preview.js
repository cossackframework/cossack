import { findProjectRoot } from '../fs-utils.js';
import { commandSpecs } from '../command-specs.js';
import { showCommandHelp, validateCommand } from '../command-spec.js';
import { commandFailure, writeResult } from '../output.js';
import { createPreview, inspectPreview, cleanupPreview } from '../preview-service.js';

export async function previewCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.preview, args, ctx, previewHelp)) return 0;
  if (!validateCommand(commandSpecs.preview, args, ctx)) return 1;
  try {
    const root = await findProjectRoot(ctx.cwd);
    const operation = { create: createPreview, inspect: inspectPreview, cleanup: cleanupPreview }[args[0]];
    const data = await operation(root, { accountId: ctx.flags.account, name: ctx.flags.name, state: ctx.flags.state, smokePath: ctx.flags.smoke ?? '/', dryRun: ctx.dryRun });
    if (ctx.flags.json) writeResult('preview', { data });
    else console.log(`Preview ${args[0]}: ${data.status}`);
    return 0;
  } catch (caught) {
    return commandFailure(ctx, 'preview', /^COSSACK_PREVIEW_[A-Z_]+$/.test(caught.code ?? '') ? caught.code : 'COSSACK_PREVIEW_FAILED',
      'Preview operation stopped. Inspect the saved journal and explicit staging configuration. Unproven ownership requires manual recovery; no unverified resource is deleted.');
  }
}
export function previewHelp() {
  return commandSpecs.preview.help(`cossack preview create --account <ID> --name <LABEL> [--state .cossack/preview.json] [--smoke /] [--dry-run] [--json]
cossack preview <inspect|cleanup> [--account <ID>] [--state .cossack/preview.json] [--json]

Create runs the existing production build gate and native Wrangler preview with
explicit staging bindings and --ignore-defaults. Dry-run only plans, without
builds, writes or authentication. Requires native Preview support and an API token.
D1/KV/R2 staging resources are retained; local Durable Objects are native-preview
owned. Workflow/service/queue and other unsupported bindings fail closed.
Required Worker secrets need separate native secret setup and are not supported.
Saved state precedes mutation; inspect and cleanup verify real provider identity
and deployment tags. Lost creation receipts require manual recovery. Cleanup
never deletes externally bound storage. Hosted CI acceptance remains required.`);
}
