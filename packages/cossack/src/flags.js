/** Parse framework options from the same metadata used by validation/help. */
import { commandSpecs } from './command-specs.js';
const defaultOptions = new Map();
for (const spec of Object.values(commandSpecs)) {
  for (const [name, definition] of spec.options([], true)) defaultOptions.set(name, definition);
}

export function parseFlags(argv, spec) {
  const args = [];
  const flags = {};
  const options = spec ? spec.options([], true) : defaultOptions;
  let onlyPositional = false;
  const fail = (code, message, supported) => {
    throw Object.assign(new Error(message), { code, ...(supported ? { supported } : {}) });
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (onlyPositional || token === '-' || !token.startsWith('-')) {
      args.push(token);
      continue;
    }
    if (token === '--') { onlyPositional = true; continue; }
    const prefix = token.startsWith('--') ? 2 : 1;
    const equal = token.indexOf('=');
    const name = token.slice(prefix, equal < 0 ? undefined : equal);
    const definition = options.get(name);
    if (spec && !definition) fail('COSSACK_OPTION_UNKNOWN',
      `Unknown option --${name} for '${spec.name}'.`, [...options.keys()].map(key => '--' + key));
    const boolean = definition?.type === 'boolean';
    let value;
    if (equal >= 0) {
      value = token.slice(equal + 1);
      if (boolean) {
        if (!['true', 'false'].includes(value)) fail('COSSACK_OPTION_INVALID', `--${name} expects true or false.`);
        value = value === 'true';
      }
    } else if (boolean) value = true;
    else {
      value = argv[++i];
      if (value === undefined || value.startsWith('-')) fail('COSSACK_OPTION_VALUE_REQUIRED', `--${name} expects a value.`);
    }
    if (boolean) flags[name] = value; // Same spelling: explicitly last wins.
    else if (flags[name] === undefined) flags[name] = value;
    else if (Array.isArray(flags[name])) flags[name].push(value);
    else flags[name] = [flags[name], value];
  }
  if (spec) {
    const diagnostics = spec.validate(args, flags);
    if (diagnostics.length) {
      const first = diagnostics[0];
      throw Object.assign(new Error(first.message), { code: first.code, diagnostics });
    }
    return { args, flags: spec.normalizeFlags(flags).flags };
  }
  // Standalone utility callers receive original spellings; dispatch uses a spec.
  if (flags.f !== undefined && flags.force === undefined) flags.force = flags.f;
  return { args, flags };
}

/** Determine JSON intent even when another option fails parsing. */
export function requestsJSON(argv) {
  let requested = false;
  for (const value of argv) {
    if (value === '--') break;
    if (value === '--json' || value === '--json=true') requested = true;
    else if (value === '--json=false') requested = false;
  }
  return requested;
}

/** Framework help intent follows boolean repetition and the forwarding boundary. */
export function requestsHelp(argv) {
  let requested = argv[0] === 'help';
  for (const value of argv) {
    if (value === '--') break;
    if (['--help', '--help=true', '-h', '-h=true'].includes(value)) requested = true;
    else if (['--help=false', '-h=false'].includes(value)) requested = false;
  }
  return requested;
}

/** Normalize a possibly-array flag value to an array. */
export function flagList(value) {
  if (value === undefined || value === false) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

/** Get a single string value for a flag. */
export function flagString(value) {
  if (value === undefined || value === true) return undefined;
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}
