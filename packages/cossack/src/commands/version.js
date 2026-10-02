import { readPackageVersion } from '../pkg.js';
import { CommandSpec, runWithSpec } from '../command-spec.js';

const spec = new CommandSpec({ name: 'version' });

export async function versionCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, () => {
    const version = readPackageVersion();
    if (ctx.flags.json === true) return { version };
    console.log(`cossack/${version}`);
    return null;
  });
}

export function versionHelp() {
  return `cossack version

Print the installed cossack CLI version.

Options:
  --json   Output JSON.`;
}
