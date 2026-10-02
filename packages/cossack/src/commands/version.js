import { commandSpecs } from '../command-specs.js';
import { readPackageVersion } from '../pkg.js';
import { runWithSpec } from '../command-spec.js';

const spec = commandSpecs.version;

export async function versionCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, () => {
    const version = readPackageVersion();
    if (ctx.flags.json === true) return { version };
    console.log(`cossack/${version}`);
    return null;
  });
}

export function versionHelp() {
  return commandSpecs.version.help(`cossack version

Print the installed cossack CLI version.`);
}
