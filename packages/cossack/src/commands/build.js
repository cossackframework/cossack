import { run } from '../spawn.js';

export async function buildCommand(args, ctx) {
  console.log('  build   vite build');
  const buildCode = await run('vite', ['build', ...args]);
  if (buildCode !== 0) return buildCode;

  // Run the SSG pass (re-invokes the cossack bin, which handles the tsx respawn).
  console.log('  ssg     cossack ssg');
  return run('cossack', ['ssg']);
}

export function buildHelp() {
  return `cossack build

Create a production build (\`vite build\`) and pre-render static pages (\`cossack ssg\`).
Extra args are forwarded to vite.`;
}
