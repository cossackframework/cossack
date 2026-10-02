/**
 * Shared command specification: one source of truth for accepted flags,
 * positional arguments, and machine-readable failures (CLI-02/CLI-03).
 *
 * Every command declares a spec and runs through `runWithSpec`, which
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

/** Flags every command accepts without declaring them. */
const GLOBAL_FLAGS = ['force', 'f', 'dry-run', 'json', 'help', 'h'];

/**
 * @typedef {Object} CommandFlag
 * @property {'boolean'|'string'} type
 * @property {string[]} [aliases]
 * @property {boolean} [repeated]  Accept the flag multiple times (last wins).
 */
export class CommandSpec {
  /** @param {{name: string, flags?: Record<string, CommandFlag>, positionals?: string[], minPositionals?: number, forwardsArgs?: boolean}} definition */
  constructor({ name, flags = {}, positionals = [], minPositionals = 0, forwardsArgs = false }) {
    this.name = name;
    this.flags = flags;
    this.positionals = positionals;
    this.minPositionals = minPositionals;
    // Commands that forward raw args to an underlying tool (vite, wrangler)
    // cannot validate unknown flags; they declare the boundary instead.
    this.forwardsArgs = forwardsArgs;
  }

  /** Validate parsed flags and positional arguments before any effect. */
  validate(args, flags) {
    const diagnostics = [];
    if (!this.forwardsArgs) {
      const accepted = new Map();
      for (const name of GLOBAL_FLAGS) accepted.set(name, { type: 'boolean' });
      for (const [flag, definition] of Object.entries(this.flags)) {
        accepted.set(flag, definition);
        for (const alias of definition.aliases ?? []) accepted.set(alias, definition);
      }
      for (const [name, value] of Object.entries(flags)) {
        const definition = accepted.get(name);
        if (definition) {
          if (Array.isArray(value) && !definition.repeated) {
            diagnostics.push({ code: 'COSSACK_OPTION_REPEATED', severity: 'error',
              message: `Option --${name} accepts one value.`, });
          } else if ((Array.isArray(value) ? value : [value]).some(item => definition.type === 'boolean'
            ? typeof item !== 'boolean' : typeof item !== 'string' || !item.trim())) {
            diagnostics.push({ code: 'COSSACK_OPTION_VALUE_REQUIRED', severity: 'error',
              message: `Option --${name} requires ${definition.type === 'boolean' ? 'true or false' : 'a nonempty string value'}.` });
          }
          continue;
        }
        diagnostics.push({
          code: 'COSSACK_OPTION_UNKNOWN',
          severity: 'error',
          message: `Unknown option --${name} for '${this.name}'.`,
          supported: [...accepted.keys()].map(name => `--${name}`),
        });
      }
    }
    if (!this.forwardsArgs && args.length > this.positionals.length) {
      diagnostics.push({
        code: 'COSSACK_ARGUMENT_UNEXPECTED',
        severity: 'error',
        message: this.positionals.length
          ? `Unexpected argument '${args[this.positionals.length]}'. '${this.name}' accepts ${this.positionals.length} positional argument(s): ${this.positionals.join(', ')}.`
          : `Unexpected argument '${args[0]}'. '${this.name}' accepts no positional arguments.`,
      });
    }
    if (args.length < this.minPositionals) {
      diagnostics.push({
        code: 'COSSACK_ARGUMENT_MISSING',
        severity: 'error',
        message: `'${this.name}' requires ${this.minPositionals} positional argument(s): ${this.positionals.slice(args.length).join(', ')}.`,
      });
    }
    return diagnostics;
  }

  /** Render the options section for command help. */
  helpOptions() {
    const lines = [];
    for (const [flag, definition] of Object.entries(this.flags)) {
      const aliases = (definition.aliases ?? []).map(a => `-${a}`).join(' ');
      const label = `  --${flag}${aliases ? `, ${aliases}` : ''}${definition.type === 'string' ? ' <value>' : ''}`;
      lines.push(label);
    }
    if (this.forwardsArgs) lines.push('  (forwards extra arguments to the underlying tool)');
    return lines;
  }
}

/**
 * Run a command handler under its spec: validate first, then execute.
 * Handlers may return a data object (emitted in the JSON envelope), an exit
 * code number (process-forwarding commands; emitted as `{ exitCode }` under
 * `--json`), or nothing. Failures produce coded diagnostics and exit code 1.
 */
export async function runWithSpec(spec, args, ctx, handler, help) {
  // The `help` positional/flag convention predates dispatcher-level handling;
  // keep it working for direct invocations and documented aliases.
  const wantsHelp = typeof help === 'function' &&
    (['help', '--help', '-h'].includes(args[0]) || ctx.flags?.help === true || ctx.flags?.h === true);
  if (wantsHelp) {
    if (ctx.flags?.json === true) writeResult(spec.name, { data: { help: help() } });
    else console.log(help());
    return 0;
  }
  const diagnostics = spec.validate(args, ctx.flags ?? {});
  if (diagnostics.length) {
    if (ctx.flags?.json === true) {
      writeResult(spec.name, { ok: false, diagnostics });
    } else {
      for (const diagnostic of diagnostics) console.error(`Error: ${diagnostic.message}`);
    }
    return 1;
  }
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
