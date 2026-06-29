import { readPackageVersion } from '../pkg.js';

export async function versionCommand(args, ctx) {
  if (ctx.flags.json) {
    const cli = readPackageVersion();
    console.log(JSON.stringify({ cossack: cli }, null, 2));
    return 0;
  }
  const cli = readPackageVersion();
  console.log(`cossack/${cli}`);
  return 0;
}

export function versionHelp() {
  return `cossack version

Print the installed cossack CLI version.

Options:
  --json   Output JSON.`;
}
