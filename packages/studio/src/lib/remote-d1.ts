import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
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

export interface RemoteD1Options {
  projectRoot: string;
  binding?: string;
  environment?: string;
  wranglerCommand?: string;
  execute?: WranglerExecutor;
  prompt?: BindingPrompt;
}

function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (char === '\\') output += input[++index] ?? '';
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index++;
      output += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index++;
      index++;
    } else {
      output += char;
    }
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function bindingsFromObject(config: any, environment?: string): D1Binding[] {
  const environmentConfig = environment ? config?.env?.[environment] : undefined;
  const configured = environmentConfig?.d1_databases ?? config?.d1_databases ?? [];
  if (!Array.isArray(configured)) return [];
  return configured
    .filter((item) => item && typeof item.binding === 'string')
    .map((item) => ({
      binding: item.binding,
      databaseName: typeof item.database_name === 'string' ? item.database_name : undefined,
      databaseId: typeof item.database_id === 'string' ? item.database_id : undefined,
    }));
}

function parseTomlBindings(input: string, environment?: string): D1Binding[] {
  const targetSection = environment ? `env.${environment}.d1_databases` : 'd1_databases';
  const bindings: D1Binding[] = [];
  let current: Record<string, string> | null = null;
  let active = false;
  const finish = () => {
    if (active && current?.binding) {
      bindings.push({
        binding: current.binding,
        databaseName: current.database_name,
        databaseId: current.database_id,
      });
    }
    current = null;
  };
  for (const line of input.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\[([^\]]+)]]\s*(?:#.*)?$/);
    if (section) {
      finish();
      active = section[1] === targetSection;
      current = active ? {} : null;
      continue;
    }
    if (!active || !current) continue;
    const property = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*["']([^"']*)["']/);
    if (property) current[property[1]] = property[2];
  }
  finish();
  return bindings;
}

export async function readD1Bindings(
  projectRoot: string,
  environment?: string,
): Promise<D1Binding[]> {
  for (const filename of ['wrangler.jsonc', 'wrangler.json']) {
    try {
      const source = await fs.readFile(path.join(projectRoot, filename), 'utf8');
      return bindingsFromObject(JSON.parse(stripJsonComments(source)), environment);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Could not read ${filename}: ${error.message}`);
      }
    }
  }
  try {
    const source = await fs.readFile(path.join(projectRoot, 'wrangler.toml'), 'utf8');
    return parseTomlBindings(source, environment);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('No wrangler.jsonc, wrangler.json, or wrangler.toml was found.');
    }
    throw new Error(`Could not read wrangler.toml: ${error.message}`);
  }
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
    private readonly options: Required<Pick<RemoteD1Options, 'projectRoot' | 'wranglerCommand' | 'execute'>> &
      Pick<RemoteD1Options, 'environment'>,
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
        this.options.wranglerCommand,
        args,
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
    wranglerCommand: options.wranglerCommand ?? path.join(
      options.projectRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
    ),
    execute: options.execute ?? executeWrangler,
  }, binding);
}
