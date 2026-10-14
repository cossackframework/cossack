import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { exists, readJsonIfExists } from './fs-utils.js';

const SUPPORTED_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const EXEC_PATH_ORDER = ['pnpm', 'yarn', 'bun', 'npm'];

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
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';

  const pkg = await readJsonIfExists(path.join(root, 'package.json'));
  return normalizePackageManager(pkg?.packageManager) ?? 'npm';
}

const SCRIPT_ENTRY = /\.[cm]?js$/i;
const WINDOWS_SHIM = /\.(?:cmd|bat|ps1)$/i;
// Arguments passed through cmd.exe must not contain shell metacharacters.
const SHELL_SAFE_ARGUMENT = /^[\w@./:=+~-]+$/;

/**
 * Resolve how to spawn a package manager without relying on PATH shims that
 * Node refuses to execute on Windows (`pnpm.cmd` needs a shell since the
 * CVE-2024-27980 fix).
 *
 * - Outside Windows, run the command from PATH, as users and wrappers expect.
 * - On Windows, when the CLI runs under the same package manager
 *   (`npm_execpath` names it), run a JavaScript entry with the current Node
 *   binary, or a native executable directly.
 * - Otherwise on Windows, run the `.cmd` shim through the shell with fixed,
 *   validated arguments.
 */
export function packageManagerInvocation(manager, args, {
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  const name = normalizePackageManager(manager);
  if (!name) throw new Error(`Unsupported package manager: ${manager}`);
  if (platform !== 'win32') return { command: name, args: [...args], shell: false };
  const entry = String(env.npm_execpath ?? '');
  const entryName = entry.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  if (entry && entryName.startsWith(name) && !WINDOWS_SHIM.test(entryName)) {
    if (SCRIPT_ENTRY.test(entryName)) return { command: execPath, args: [entry, ...args], shell: false };
    return { command: entry, args: [...args], shell: false };
  }
  const unsafe = args.find(argument => !SHELL_SAFE_ARGUMENT.test(argument));
  if (unsafe !== undefined) {
    throw new Error(`Refusing to pass ${JSON.stringify(unsafe)} to ${name} through the Windows shell.`);
  }
  return { command: `${name}.cmd`, args: [...args], shell: true };
}

const execFileP = promisify(execFile);

/** `execFile` a package manager command resolved by {@link packageManagerInvocation}. */
export function execPackageManager(manager, args, options = {}) {
  const invocation = packageManagerInvocation(manager, args);
  return execFileP(invocation.command, invocation.args, { ...options, shell: invocation.shell, windowsHide: true });
}
