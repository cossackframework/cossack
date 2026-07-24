import path from 'node:path';
import {
  ADAPTERS,
  switchAdapter,
} from '@cossackframework/scaffold';
import {
  exists,
  findProjectRoot,
  readJsonIfExists,
} from '../fs-utils.js';
import { flagString } from '../flags.js';

export async function adapterCommand(args, ctx) {
  if (ctx.flags.help === true || ctx.flags.h === true) {
    console.log(adapterHelp());
    return 0;
  }
  const [target] = args;
  if (!target || !ADAPTERS.includes(target)) {
    console.error(
      `Unknown adapter: ${target || '(none)'}.\n` +
      `Supported values: ${ADAPTERS.join(', ')}`,
    );
    return 1;
  }

  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await switchAdapter(root, target, {
      database: flagString(ctx.flags.database),
      force: ctx.force,
      dryRun: ctx.dryRun,
      yes: ctx.flags.yes === true || ctx.flags.y === true,
      interactive: ctx.flags.yes !== true &&
        ctx.flags.y !== true &&
        !ctx.dryRun,
    });
    if (result.status === 'present') {
      console.log(`  present  ${target} is already the active adapter`);
      return 0;
    }
    if (result.status === 'cancelled') {
      console.log('Cancelled. No files were changed.');
      return 0;
    }
    if (result.status === 'dry-run') {
      printChanges(result.changes, 'Would');
      console.log(
        `Dry run only. Adapter would change from ` +
        `${result.previousAdapter} to ${result.targetAdapter}.`,
      );
      return 0;
    }

    console.log(
      `Changed adapter from ${result.previousAdapter} to ${result.targetAdapter}. ` +
      `Applied ${result.changes.writes.length} write(s) and ` +
      `${result.changes.deletes.length} deletion(s).`,
    );
    const install = await detectInstallCommand(root);
    console.log(`\nNext: run \`${install}\` to reconcile dependencies.`);
    if (result.databaseChange.installed) {
      console.log('No database contents were migrated.');
      if (result.databaseChange.target === 'd1') {
        console.log(
          'Configure the D1 binding in `wrangler.jsonc`, then run ' +
          '`cossack migration up`.',
        );
      } else if (result.databaseChange.target === 'sqlite') {
        console.log(
          'Review `DB_PATH` in `.env`, then run `cossack migration up`.',
        );
      } else {
        const environment = result.targetAdapter === 'node' ? '.env' : '.dev.vars';
        console.log(
          `Configure \`TURSO_URL\` and \`TURSO_TOKEN\` in \`${environment}\`, ` +
          'then run `cossack migration up`.',
        );
      }
    }
    return 0;
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    console.error(`  error   ${error.message}`);
    return 1;
  }
}

function printChanges(changes, prefix) {
  for (const change of changes.writes) {
    console.log(
      `  ${prefix} ${change.overwrite ? 'update' : 'create'}  ${change.path}`,
    );
  }
  for (const change of changes.deletes) {
    console.log(`  ${prefix} delete  ${change.path}`);
  }
  for (const change of changes.preserved) {
    console.log(`  preserve  ${change.path}  [${change.reason}]`);
  }
}

export async function detectInstallCommand(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm install';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn install';
  if (await exists(path.join(root, 'bun.lock')) ||
      await exists(path.join(root, 'bun.lockb'))) return 'bun install';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm install';
  const pkg = await readJsonIfExists(path.join(root, 'package.json'));
  const manager = String(pkg?.packageManager ?? '').split('@')[0];
  if (['pnpm', 'yarn', 'bun', 'npm'].includes(manager)) {
    return `${manager} install`;
  }
  return 'npm install';
}

export function adapterHelp() {
  return `cossack adapter <node|cloudflare>

Switch a schema-v2 scaffolded project to one runtime adapter. The complete
recorded recipe is re-rendered; application features and unrelated edits are
preserved. Database contents are never migrated.

Options:
  --database <d1|sqlite|turso>  Select a compatible database provider
  --yes                         Apply without confirmation
  --dry-run                     Preview every change without writing
  --force                       Replace conflicting runtime/provider files`;
}
