import { run } from '../spawn.js';

export async function devCommand(args, ctx) {
  console.log('  start   vite dev');
  return run('vite', ['dev', ...args]);
}

export function devHelp() {
  return `cossack dev

Start the development server (delegates to \`vite dev\`).
Any extra args are forwarded to vite.`;
}
