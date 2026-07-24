/**
 * Minimal argv flag parser.
 *
 * Supports:
 *   --flag value
 *   --flag=value
 *   -f value            (single-char aliases)
 *   --bool              (true when present)
 *   --                  (everything after is positional)
 *
 * Returns `{ args: string[], flags: Record<string, string|boolean|string[]> }`.
 * Repeated `--force-file a --force-file b` collects into an array.
 */

const KNOWN_BOOL = new Set([
  'force',
  'f',
  'dry-run',
  'json',
  'verbose',
  'apply-template',
  'head',
  'no-index',
  'ni',
  'yes',
  'y',
]);

export function parseFlags(argv) {
  const args = [];
  const flags = {};
  let onlyPositional = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (onlyPositional) {
      args.push(tok);
      continue;
    }

    if (tok === '--') {
      onlyPositional = true;
      continue;
    }

    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        const name = tok.slice(2, eq);
        const value = tok.slice(eq + 1);
        setFlag(flags, name, value);
      } else {
        const name = tok.slice(2);
        if (KNOWN_BOOL.has(name)) {
          setFlag(flags, name, true);
        } else {
          // expect a value
          const next = argv[i + 1];
          if (next === undefined || next.startsWith('-')) {
            setFlag(flags, name, true);
          } else {
            setFlag(flags, name, next);
            i++;
          }
        }
      }
      continue;
    }

    if (tok.startsWith('-') && tok.length > 1 && tok !== '-') {
      const name = tok.slice(1);
      if (KNOWN_BOOL.has(name)) {
        setFlag(flags, name, true);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) {
          setFlag(flags, name, true);
        } else {
          setFlag(flags, name, next);
          i++;
        }
      }
      continue;
    }

    args.push(tok);
  }

  // Convenience aliases mapped to canonical names.
  if (flags.f !== undefined && flags.force === undefined) flags.force = flags.f;
  if (flags.force !== undefined) flags.force = flags.force !== false;

  return { args, flags };
}

function setFlag(flags, name, value) {
  if (flags[name] === undefined) {
    flags[name] = value;
    return;
  }
  if (Array.isArray(flags[name])) {
    flags[name].push(value);
  } else {
    flags[name] = [flags[name], value];
  }
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
