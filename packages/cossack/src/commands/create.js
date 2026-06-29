import path from 'node:path';
import { flagString } from '../flags.js';

export async function createCommand(args, ctx) {
  const [projectName] = args;
  if (!projectName) {
    console.error('Missing project name. Usage: cossack create <project-name>');
    return 1;
  }

  const adapter = flagString(ctx.flags.adapter);
  if (adapter && adapter !== 'cloudflare' && adapter !== 'node') {
    console.error(`Invalid --adapter "${adapter}". Use cloudflare or node.`);
    return 1;
  }

  let createApp;
  try {
    ({ createApp } = await import('create-cossack-app'));
  } catch {
    console.error(
      'Could not load create-cossack-app. Ensure the "cossack" package is installed.',
    );
    return 1;
  }

  try {
    const { projectDir, adapter: used } = await createApp(projectName, { adapter });
    const dirName = path.basename(projectDir);
    console.log(`\nCossack app created in ${projectDir} (adapter: ${used})\n`);
    console.log('Next steps:');
    console.log(`  cd ${dirName}`);
    console.log('  pnpm install');
    if (used === 'node') {
      console.log('  pnpm run build');
      console.log('  pnpm start');
    } else {
      console.log('  cossack dev');
    }
    return 0;
  } catch (error) {
    console.error('Error creating Cossack app:', error.message);
    return 1;
  }
}

export function createHelp() {
  return `cossack create <project-name>

Scaffold a new Cossack project.

Options:
  --adapter <cloudflare|node>   Skip the adapter prompt.`;
}
