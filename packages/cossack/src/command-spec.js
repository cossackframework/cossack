/**
 * Shared command specification: one source of truth for accepted flags,
 * positional arguments, and machine-readable failures (CLI-02/CLI-03).
 *
 * Every command declares a spec and uses shared preflight validation, which
 * validates unknown options and positional counts before any effect, and
 * emits the versioned JSON envelope under `--json` with stable codes:
 *
 *   COSSACK_OPTION_UNKNOWN     Flag is not accepted by this command.
 *   COSSACK_OPTION_VALUE_REQUIRED  Flag needs a value.
 *   COSSACK_ARGUMENT_UNEXPECTED   Extra positional argument.
 *   COSSACK_ARGUMENT_MISSING      Required positional argument absent.
 */
import path from 'node:path';
import { writeResult } from './output.js';

export const GLOBAL_FLAGS = {
  force: { type: 'boolean', aliases: ['f'], repeated: 'last', description: 'Overwrite owned files / skip confirmation.' },
  'dry-run': { type: 'boolean', repeated: 'last', description: 'Preview effects without applying changes.' },
  json: { type: 'boolean', repeated: 'last', description: 'Emit versioned JSON without prompts.' },
  help: { type: 'boolean', aliases: ['h'], repeated: 'last', description: 'Show command help.' },
};

/** Shared parser, preflight, and help metadata. */
export class CommandSpec {
  constructor({ name, aliases = [], flags = {}, globals = Object.keys(GLOBAL_FLAGS),
    positionals = [], minPositionals = 0, forwardsArgs = false, subcommands, check }) {
    Object.assign(this, { name, aliases, flags, globals, positionals, minPositionals, forwardsArgs, subcommands, check });
  }

  definitions(args, all = false) {
    const definitions = Object.fromEntries(this.globals.map(name => [name, GLOBAL_FLAGS[name]]));
    Object.assign(definitions, this.flags);
    if (all) for (const sub of Object.values(this.subcommands ?? {})) Object.assign(definitions, sub.flags);
    else Object.assign(definitions, this.subcommands?.[args?.[0]]?.flags);
    return definitions;
  }

  options(args, all = false) {
    const accepted = new Map();
    for (const [name, definition] of Object.entries(this.definitions(args, all))) {
      accepted.set(name, { name, ...definition });
      for (const alias of definition.aliases ?? []) accepted.set(alias, { name, ...definition });
    }
    return accepted;
  }

  normalizeFlags(flags) {
    const accepted = this.options([], true);
    const normalized = {};
    const diagnostics = [];
    for (const [spelling, value] of Object.entries(flags)) {
      const name = accepted.get(spelling)?.name ?? spelling;
      if (Object.hasOwn(normalized, name) && JSON.stringify(normalized[name]) !== JSON.stringify(value)) {
        diagnostics.push({ code: 'COSSACK_OPTION_CONFLICT', severity: 'error',
          message: `Conflicting values were supplied for --${name} and its alias.` });
      } else normalized[name] = value;
    }
    return { flags: normalized, diagnostics };
  }

  validate(args, flags) {
    if (this.forwardsArgs) return [];
    const normalized = this.normalizeFlags(flags);
    const diagnostics = [...normalized.diagnostics];
    const accepted = this.options(args);
    flags = normalized.flags;
    for (const [name, value] of Object.entries(flags)) {
      const definition = accepted.get(name);
      if (!definition) {
        diagnostics.push({ code: 'COSSACK_OPTION_UNKNOWN', severity: 'error',
          message: `Unknown option --${name} for '${this.name}'${this.subcommands ? ' ' + (args[0] ?? '') : ''}.`,
          supported: [...accepted.keys()].map(name => `--${name}`) });
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      if (Array.isArray(value) && !definition.repeated) {
        diagnostics.push({ code: 'COSSACK_OPTION_REPEATED', severity: 'error',
          message: `Option --${name} accepts one value.` });
      } else if (values.some(item => definition.type === 'boolean'
        ? typeof item !== 'boolean' : typeof item !== 'string' || !item.trim())) {
        diagnostics.push({ code: 'COSSACK_OPTION_VALUE_REQUIRED', severity: 'error',
          message: `Option --${name} requires ${definition.type === 'boolean' ? 'true or false' : 'a nonempty string value'}.` });
      } else {
        if (definition.choices && values.flatMap(item => definition.list ? item.split(',').map(s => s.trim()) : [item])
          .some(item => !definition.choices.includes(item))) {
          diagnostics.push({ code: 'COSSACK_OPTION_INVALID', severity: 'error',
            message: `Option --${name} accepts: ${definition.choices.join(', ')}.` });
        }
        if (definition.when && !definition.when.includes(args[0])) {
          diagnostics.push({ code: 'COSSACK_OPTION_UNSUPPORTED', severity: 'error',
            message: `Option --${name} is supported for: ${definition.when.join(', ')}.` });
        }
      }
    }
    const sub = this.subcommands?.[args[0]];
    if (this.subcommands && args.length && !sub) diagnostics.push({
      code: 'COSSACK_ACTION_UNKNOWN', severity: 'error',
      message: `Unknown subcommand for '${this.name}'. Available: ${Object.keys(this.subcommands).join(', ')}.`,
    });
    const positionals = this.subcommands && sub ? ['subcommand', ...(sub.positionals ?? [])] : this.positionals;
    if (args.length > positionals.length) diagnostics.push({
      code: 'COSSACK_ARGUMENT_UNEXPECTED', severity: 'error',
      message: `'${this.name}' accepts ${positionals.length} positional argument(s): ${positionals.join(', ') || '(none)'}.`,
    });
    if (args.length < this.minPositionals) diagnostics.push({
      code: 'COSSACK_ARGUMENT_MISSING', severity: 'error',
      message: `'${this.name}' requires ${this.minPositionals} positional argument(s): ${this.positionals.slice(args.length).join(', ')}.`,
    });
    // Custom constraints only run after type validation, before any project import.
    if (!diagnostics.length && this.check) diagnostics.push(...this.check(args, flags));
    return diagnostics;
  }

  helpOptions() {
    const lines = [];
    for (const [flag, definition] of Object.entries(this.definitions([], true))) {
      const aliases = (definition.aliases ?? []).map(a => `${a.length === 1 ? '-' : '--'}${a}`).join(', ');
      const label = `  --${flag}${aliases ? ', ' + aliases : ''}${definition.type === 'string'
        ? ' <' + (definition.choices?.join('|') ?? 'value') + '>' : ''}`;
      const scopes = this.subcommands ? Object.entries(this.subcommands)
        .filter(([, sub]) => Object.hasOwn(sub.flags ?? {}, flag)).map(([name]) => name) : definition.when;
      lines.push(label + (definition.description ? '  ' + definition.description : '') +
        (scopes?.length ? ' (' + scopes.join(', ') + ')' : ''));
    }
    if (this.forwardsArgs) lines.push('  Extra arguments are forwarded verbatim to the underlying tool; -- ends framework option handling.');
    return lines;
  }

  help(prose) {
    return prose.trimEnd() + '\n\nOptions:\n' + this.helpOptions().join('\n');
  }
}

/** Help is read-only and never needs a project or required positional values. */
export function showCommandHelp(spec, args, ctx, help) {
  if (typeof help !== 'function' || !(ctx.flags?.help === true || ctx.flags?.h === true ||
      ['help', '--help', '-h'].includes(args[0]))) return false;
  if (ctx.flags?.json === true) writeResult(spec.name, { data: { help: help() } });
  else console.log(help());
  return true;
}

/** Validate direct API calls as well as dispatcher calls. Does not emit success. */
export function validateCommand(spec, args, ctx) {
  const diagnostics = spec.validate(args, ctx.flags ?? {});
  if (diagnostics.length) {
    if (ctx.flags?.json === true) writeResult(spec.name, { ok: false, diagnostics });
    else for (const diagnostic of diagnostics) console.error(`Error: ${diagnostic.message}`);
    return false;
  }
  ctx.flags = spec.normalizeFlags(ctx.flags ?? {}).flags;
  if (ctx.flags.force !== undefined) ctx.force = ctx.flags.force === true;
  if (ctx.flags['dry-run'] !== undefined) ctx.dryRun = ctx.flags['dry-run'] === true;
  return true;
}

/**
 * Run a command handler under its spec: validate first, then execute.
 * Handlers may return a data object (emitted in the JSON envelope), an exit
 * code number (process-forwarding commands; emitted as `{ exitCode }` under
 * `--json`), or nothing. Failures produce coded diagnostics and exit code 1.
 */
export async function runWithSpec(spec, args, ctx, handler, help) {
  if (showCommandHelp(spec, args, ctx, help)) return 0;
  if (!validateCommand(spec, args, ctx)) return 1;
  try {
    const result = await handler(args, ctx);
    if (typeof result === 'number') {
      if (ctx.flags?.json === true) {
        writeResult(spec.name, { ok: result === 0, data: ctx.out?.data({ exitCode: result }) ?? { exitCode: result },
          diagnostics: result === 0 ? [] : [{ code: result === 130 ? 'COSSACK_COMMAND_ABORTED' : 'COSSACK_COMMAND_FAILED',
            severity: 'error', message: `Command '${spec.name}' exited with code ${result}.` }] });
      }
      return result;
    }
    if (result && typeof result === 'object' && typeof result.exitCode === 'number') {
      if (ctx.flags?.json === true) {
        writeResult(spec.name, { ok: result.exitCode === 0, data: result.data ?? { exitCode: result.exitCode },
          diagnostics: result.diagnostics ?? (result.exitCode === 0 ? [] : [{ code: 'COSSACK_COMMAND_FAILED',
            severity: 'error', message: `Command '${spec.name}' exited with code ${result.exitCode}.` }]) });
      }
      return result.exitCode;
    }
    if (ctx.flags?.json === true) {
      writeResult(spec.name, { ok: true, data: result ?? null });
    }
    return 0;
  } catch (error) {
    if (ctx.flags?.json === true) {
      writeResult(spec.name, {
        ok: false,
        diagnostics: [{ code: error.code ?? 'COSSACK_COMMAND_FAILED', severity: 'error', message: error.message }],
      });
    } else {
      console.error(error.message);
    }
    return 1;
  }
}

/**
 * One formatter for command output (CLI-03): handlers record structured
 * effects and print human lines through the same object. Under `--json`
 * nothing prints; the recorded effects become the envelope's `data`.
 */
export function createCommandOutput(ctx) {
  const json = ctx.flags?.json === true;
  const effects = [];
  return {
    effects,
    /** Record a file effect (`created|overwritten|planned|planned-delete|skipped|preserved|deleted`). */
    file(action, target) {
      const relative = path.relative(process.cwd(), target);
      effects.push({ action, path: relative });
      if (!json) {
        if (action === 'skipped') console.error(`  exists    ${relative} (use --force to overwrite)`);
        else console.log(`  ${action.padEnd(9)} ${relative}`);
      }
      return action === 'skipped' ? 1 : 0;
    },
    /** Human-only informational line (never part of the JSON result). */
    line(text) { if (!json) console.log(text); },
    /** Human-only warning line (never part of the JSON result). */
    warn(text) { if (!json) console.error(text); },
    /** The structured result data for the JSON envelope. */
    data(extra = {}) { return { effects, ...extra }; },
  };
}
