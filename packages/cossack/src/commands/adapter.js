import {
  ADAPTERS,
  switchAdapter,
} from '@cossackframework/scaffold';
import {
  findProjectRoot,
} from '../fs-utils.js';
import { flagString } from '../flags.js';
import {
  detectProjectPackageManager,
  packageManagerCommands,
} from '../package-manager.js';
import { CommandSpec, runWithSpec, createCommandOutput } from '../command-spec.js';

const spec = new CommandSpec({
  name: 'adapter',
  positionals: ['adapter'],
  minPositionals: 1,
  flags: {
    database: { type: 'string' },
    yes: { type: 'boolean', aliases: ['y'] },
  },
});

export async function adapterCommand(args, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  return runWithSpec(spec, args, ctx, async () => {
  const [target] = args;
  if (!ADAPTERS.includes(target)) {
    throw Object.assign(
      new Error(`Unknown adapter: ${target}. Supported values: ${ADAPTERS.join(', ')}`),
      { code: 'COSSACK_ADAPTER_UNKNOWN' },
    );
  }

  try {
    const root = await findProjectRoot(ctx.cwd);
    const result = await switchAdapter(root, target, {
      database: flagString(ctx.flags.database),
      force: ctx.force,
      dryRun: ctx.dryRun,
      yes: ctx.flags.yes === true || ctx.flags.y === true,
      interactive: ctx.flags.json !== true && Boolean(process.stdin.isTTY) &&
        ctx.flags.yes !== true &&
        ctx.flags.y !== true &&
        !ctx.dryRun,
    });
    if (result.status === 'present') {
      ctx.out.line(`  present  ${target} is already the active adapter`);
      return { ...result, nextActions: [] };
    }
    if (result.status === 'cancelled') {
      ctx.out.line('Cancelled. No files were changed.');
      return { ...result, nextActions: [] };
    }
    if (result.status === 'dry-run') {
      printChanges(result.changes, 'Would', ctx.out);
      ctx.out.line(
        `Dry run only. Adapter would change from ` +
        `${result.previousAdapter} to ${result.targetAdapter}.`,
      );
      return { ...result, nextActions: [] };
    }

    ctx.out.line(
      `Changed adapter from ${result.previousAdapter} to ${result.targetAdapter}. ` +
      `Applied ${result.changes.writes.length} write(s) and ` +
      `${result.changes.deletes.length} deletion(s).`,
    );
    const install = await detectInstallCommand(root);
    ctx.out.line(`\nNext: run \`${install}\` to reconcile dependencies.`);
    if (result.databaseChange.installed) {
      ctx.out.line('Database contents are unaffected by adapter switching.');
      if (result.databaseChange.target === 'd1') {
        ctx.out.line(
          'Configure the D1 binding in `wrangler.jsonc`, then run ' +
          '`cossack migration up`.',
        );
      } else if (result.databaseChange.target === 'sqlite') {
        ctx.out.line(
          'Review `DB_PATH` in `.env`, then run `cossack migration up`.',
        );
      } else {
        const environment = result.targetAdapter === 'cloudflare' ? '.dev.vars' : '.env';
        ctx.out.line(
          `Configure \`TURSO_DATABASE_URL\` and \`TURSO_AUTH_TOKEN\` in \`${environment}\`, ` +
          'then run `cossack migration up`.',
        );
      }
    }
    return { ...result, nextActions: [install, ...(result.databaseChange.installed ? ['cossack migration up'] : [])] };
  } catch (error) {
    if (error?.code === 'COSSACK_PROMPT_ABORTED') return 130;
    error.code ??= 'COSSACK_ADAPTER_FAILED';
    throw error;
  }
  }, adapterHelp);
}

function printChanges(changes, prefix, out) {
  for (const change of changes.writes) {
    out.line(
      `  ${prefix} ${change.overwrite ? 'update' : 'create'}  ${change.path}`,
    );
  }
  for (const change of changes.deletes) {
    out.line(`  ${prefix} delete  ${change.path}`);
  }
  for (const change of changes.preserved) {
    out.line(`  preserve  ${change.path}  [${change.reason}]`);
  }
}

export async function detectInstallCommand(root) {
  return packageManagerCommands(await detectProjectPackageManager(root)).install;
}

export function adapterHelp() {
  return `cossack adapter <node|cloudflare|deno>

Switch a schema-v3 scaffolded project to one runtime adapter. The complete
recorded recipe is re-rendered; application features and unrelated edits are
preserved. Database contents are never migrated.

Options:
  --database <provider>          Select a compatible ORM database provider
  --yes                         Apply without confirmation
  --dry-run                     Preview every change without writing
  --force                       Replace conflicting runtime/provider files`;
}
