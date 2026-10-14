import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readD1ToolingBindings } from '@cossackframework/database/tooling';
import path from 'node:path';
import prompts from 'prompts';
import { OperationQueue } from './queue.js';
import type { StudioConnection, StudioQueryResult } from './schema-types.js';

export interface D1Binding {
  binding: string;
  databaseName?: string;
  databaseId?: string;
}

export interface WranglerCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WranglerExecutor = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<WranglerCommandResult>;

export type BindingPrompt = (bindings: readonly D1Binding[]) => Promise<string | undefined>;

export interface WranglerInvocation {
  command: string;
  /** Arguments placed before the Wrangler subcommand (e.g. the CLI entry). */
  args: string[];
}

/**
 * Resolve how to run the project's Wrangler without a shell. Studio runs the
 * package's JavaScript entry (`bin.wrangler` in wrangler/package.json) with
 * the current Node executable on every platform. On Windows, spawning the
 * `node_modules/.bin/wrangler.cmd` shim with `shell: false` is refused by
 * Node (CVE-2024-27980), and enabling a shell would expose SQL arguments to
 * cmd.exe parsing.
 */
export function resolveWranglerInvocation(
  projectRoot: string,
  options: { platform?: NodeJS.Platform; execPath?: string } = {},
): WranglerInvocation {
  const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
  let entry: string | undefined;
  try {
    // wrangler's "exports" map hides bin/wrangler.js; package.json is exported.
    const packageJsonPath = requireFromProject.resolve('wrangler/package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.wrangler;
    if (bin) entry = path.resolve(path.dirname(packageJsonPath), bin);
  } catch {
    entry = undefined;
  }
  if (!entry) {
    const platform = options.platform ?? process.platform;
    throw new Error(
      'Wrangler is not installed in this project. Install it with `pnpm add -D wrangler` ' +
      '(or your package manager) before using `cossack studio --remote`.' +
      (platform === 'win32'
        ? ' Studio runs Wrangler through Node and does not use the wrangler.cmd shim.'
        : ''),
    );
  }
  return { command: options.execPath ?? process.execPath, args: [entry] };
}

export interface RemoteD1Options {
  projectRoot: string;
  binding?: string;
  environment?: string;
  /** Override the Wrangler executable (no extra leading arguments). */
  wranglerCommand?: string;
  execute?: WranglerExecutor;
  prompt?: BindingPrompt;
}

export async function readD1Bindings(
  projectRoot: string,
  environment?: string,
): Promise<D1Binding[]> {
  return [...await readD1ToolingBindings({ cwd: projectRoot, environment })];
}

export async function selectD1Binding(
  bindings: readonly D1Binding[],
  requested?: string,
  prompt: BindingPrompt = defaultBindingPrompt,
): Promise<D1Binding> {
  if (requested) {
    const match = bindings.find((binding) => binding.binding === requested);
    if (!match) {
      throw new Error(
        `D1 binding "${requested}" was not found. Available bindings: ` +
        (bindings.map((binding) => binding.binding).join(', ') || '(none)'),
      );
    }
    return match;
  }
  if (bindings.length === 0) throw new Error('No D1 database bindings are configured for this project.');
  if (bindings.length === 1) return bindings[0];
  if (!process.stdin.isTTY && prompt === defaultBindingPrompt) {
    throw new Error('Several D1 bindings are configured. Pass --database <binding>.');
  }
  const selected = await prompt(bindings);
  const binding = bindings.find((candidate) => candidate.binding === selected);
  if (!binding) throw new Error('No D1 binding was selected.');
  return binding;
}

async function defaultBindingPrompt(bindings: readonly D1Binding[]): Promise<string | undefined> {
  const result = await prompts({
    type: 'select',
    name: 'binding',
    message: 'D1 database binding',
    choices: bindings.map((binding) => ({
      title: binding.databaseName
        ? `${binding.binding} (${binding.databaseName})`
        : binding.binding,
      value: binding.binding,
    })),
  });
  return result.binding;
}

export function executeWrangler(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<WranglerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => reject(
      new Error(`Could not start Wrangler (${command}): ${error.message}`),
    ));
    child.once('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

function parseWranglerResult(output: string): {
  rows: Record<string, unknown>[];
  affectedRows: number;
  insertId?: string;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Wrangler returned malformed JSON.');
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || typeof entry !== 'object') throw new Error('Wrangler returned an empty result.');
  if (entry.success === false) {
    throw new Error(entry.error ?? entry.message ?? 'Remote D1 query failed.');
  }
  const rows = Array.isArray(entry.results) ? entry.results : [];
  return {
    rows,
    affectedRows: Number(entry.meta?.changes ?? entry.changes ?? 0),
    insertId: entry.meta?.last_row_id == null ? undefined : String(entry.meta.last_row_id),
  };
}

export class RemoteD1Connection implements StudioConnection {
  readonly info;
  private readonly queue = new OperationQueue();

  constructor(
    private readonly options: Required<Pick<RemoteD1Options, 'projectRoot' | 'execute'>> &
      Pick<RemoteD1Options, 'environment'> & { wrangler: WranglerInvocation },
    readonly binding: D1Binding,
  ) {
    this.info = {
      provider: 'd1-remote' as const,
      label: binding.databaseName ?? binding.binding,
      remote: true,
      binding: binding.binding,
      environment: options.environment,
    };
  }

  execute(sql: string, parameters: readonly unknown[] = []): Promise<StudioQueryResult> {
    if (parameters.length) {
      throw new Error('Remote D1 statements must be rendered with escaped SQLite literals.');
    }
    return this.queue.run(async () => {
      const args = ['d1', 'execute', this.binding.binding, '--remote', '--json', '--command', sql];
      if (this.options.environment) args.push('--env', this.options.environment);
      const started = performance.now();
      const result = await this.options.execute(
        this.options.wrangler.command,
        [...this.options.wrangler.args, ...args],
        this.options.projectRoot,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Wrangler exited with code ${result.exitCode}: ` +
          (result.stderr.trim() || result.stdout.trim() || 'remote D1 command failed'),
        );
      }
      return { ...parseWranglerResult(result.stdout), durationMs: performance.now() - started };
    });
  }

  close(): Promise<void> {
    return this.queue.close(async () => {});
  }
}

export async function createRemoteD1Connection(options: RemoteD1Options): Promise<RemoteD1Connection> {
  const bindings = await readD1Bindings(options.projectRoot, options.environment);
  const binding = await selectD1Binding(bindings, options.binding, options.prompt);
  return new RemoteD1Connection({
    projectRoot: options.projectRoot,
    environment: options.environment,
    wrangler: options.wranglerCommand
      ? { command: options.wranglerCommand, args: [] }
      : resolveWranglerInvocation(options.projectRoot),
    execute: options.execute ?? executeWrangler,
  }, binding);
}
