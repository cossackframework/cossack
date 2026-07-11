import { run } from '../spawn.js';

export async function buildCommand(args, ctx) {
  console.log('  build   vite build');
  // SSG runs inside `vite build` via the cossackSsg plugin's closeBundle hook,
  // so there is no separate SSG step to invoke here.
  return run('vite', ['build', ...args]);
}

export function buildHelp() {
  return `cossack build

Create a production build (\`vite build\`). Pages marked \`ssg: true\` are
pre-rendered to static HTML during the build via the \`cossackSsg\` plugin.
Extra args are forwarded to vite.`;
}
