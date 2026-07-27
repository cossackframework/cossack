import path from 'node:path';
import { exists, readJsonIfExists } from './fs-utils.js';

const SUPPORTED_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno']);
const EXEC_PATH_ORDER = ['pnpm', 'yarn', 'bun', 'deno', 'npm'];

export function normalizePackageManager(value) {
  const manager = String(value ?? '').trim().toLowerCase().split(/[/@]/)[0];
  return SUPPORTED_MANAGERS.has(manager) ? manager : undefined;
}

export function detectInvokedPackageManager({
  env = process.env,
  versions = process.versions,
  execPath = process.execPath,
} = {}) {
  const userAgent = String(env.npm_config_user_agent ?? '').trim().split(/\s+/)[0];
  const fromUserAgent = normalizePackageManager(userAgent);
  if (fromUserAgent) return fromUserAgent;

  const execAgent = String(env.npm_execpath ?? '').toLowerCase();
  for (const manager of EXEC_PATH_ORDER) {
    if (execAgent.includes(manager)) return manager;
  }

  if (versions?.bun || env.BUN_INSTALL) return 'bun';
  if (env.DENO_VERSION || /(?:^|[/\\])deno(?:\.exe)?$/i.test(execPath)) return 'deno';
  return 'npm';
}

export function packageManagerCommands(manager) {
  switch (normalizePackageManager(manager)) {
    case 'pnpm':
      return {
        install: 'pnpm install',
        dev: 'pnpm dev',
        upgrade: 'pnpm exec cossack upgrade',
      };
    case 'yarn':
      return {
        install: 'yarn install',
        dev: 'yarn dev',
        upgrade: 'yarn cossack upgrade',
      };
    case 'bun':
      return {
        install: 'bun install',
        dev: 'bun run dev',
        upgrade: 'bun run cossack upgrade',
      };
    case 'deno':
      return {
        install: 'deno install',
        dev: 'deno task dev',
        upgrade: 'deno x -A npm:cossack upgrade',
      };
    default:
      return {
        install: 'npm install',
        dev: 'npm run dev',
        upgrade: 'npx cossack upgrade',
      };
  }
}

export async function detectProjectPackageManager(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lock')) ||
      await exists(path.join(root, 'bun.lockb'))) return 'bun';
  if (await exists(path.join(root, 'deno.lock'))) return 'deno';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';

  const pkg = await readJsonIfExists(path.join(root, 'package.json'));
  return normalizePackageManager(pkg?.packageManager) ?? 'npm';
}
