import type { Migration } from "./types.js";
import { digestEvidence } from "./plan.js";

const WORD = /[\w$\u0080-￿]/;
const REGEX_PREFIX = /[(,=:[!&|?{};+\-*%<>~^]$/;
const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/** Rewrites the body of a single-quoted string literal as a double-quoted literal. */
function doubleQuoted(body: string): string {
  let result = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (char === "\\" && index + 1 < body.length) {
      const escaped = body[++index]!;
      result += escaped === "'" ? "'" : `\\${escaped}`;
    } else {
      result += char === '"' ? '\\"' : char;
    }
  }
  return `"${result}"`;
}

/**
 * Normalizes function source text so build tools that only reformat code do not
 * change a migration checksum. Comments are removed, whitespace is collapsed to
 * what separates two identifiers, `;` counts as whitespace (automatic semicolon
 * insertion), trailing commas are dropped and single-quoted strings are
 * rewritten with double quotes. String, template and regex contents are kept.
 */
export function normalizeSource(source: string): string {
  let output = "";
  let separate = false;
  let index = 0;
  const emit = (text: string, code = true) => {
    if (separate && output && WORD.test(output.at(-1)!) && WORD.test(text[0]!)) output += " ";
    separate = false;
    if (code && /^[)\]}]$/.test(text) && output.endsWith(",")) output = output.slice(0, -1);
    output += text;
  };
  const readQuoted = (quote: string): string => {
    let end = index + 1;
    while (end < source.length && source[end] !== quote) end += source[end] === "\\" ? 2 : 1;
    const text = source.slice(index, end + 1);
    index = end + 1;
    return text;
  };
  const readTemplate = (): string => {
    let end = index + 1;
    let depth = 0;
    while (end < source.length) {
      const char = source[end]!;
      if (char === "\\") { end += 2; continue; }
      if (depth === 0 && char === "`") break;
      if (char === "$" && source[end + 1] === "{") { depth++; end += 2; continue; }
      if (depth > 0 && char === "{") depth++;
      if (depth > 0 && char === "}") depth--;
      end++;
    }
    const text = source.slice(index, end + 1);
    index = end + 1;
    return text;
  };
  const readRegex = (): string => {
    let end = index + 1;
    let inClass = false;
    while (end < source.length) {
      const char = source[end]!;
      if (char === "\\") { end += 2; continue; }
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) break;
      else if (char === "\n") break;
      end++;
    }
    end++;
    while (end < source.length && /[a-z]/i.test(source[end]!)) end++;
    const text = source.slice(index, end);
    index = end;
    return text;
  };

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (/\s/.test(char) || char === ";") {
      separate = true;
      index++;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      separate = true;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      separate = true;
    } else if (char === "'") {
      emit(doubleQuoted(readQuoted("'").slice(1, -1)), false);
    } else if (char === '"') {
      emit(readQuoted('"'), false);
    } else if (char === "`") {
      emit(readTemplate(), false);
    } else if (char === "/" && (output === "" || REGEX_PREFIX.test(output) || REGEX_KEYWORD.test(output))) {
      emit(readRegex(), false);
    } else {
      emit(char);
      index++;
    }
  }
  return output;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function callbackOnly(migration: Migration): boolean {
  return !migration.operations && Boolean(migration.up && migration.down);
}

function callbackSource(migration: Migration, normalize: (source: string) => string): string {
  return `${migration.name}\n${JSON.stringify(migration.replaces ?? [])}\n` +
    `${normalize(Function.prototype.toString.call(migration.up))}\n${normalize(Function.prototype.toString.call(migration.down))}`;
}

/**
 * The checksum recorded for a migration. Operation-based migrations hash their
 * declared operations (unchanged from earlier releases). Callback migrations
 * hash their normalized `up`/`down` source text.
 */
export async function migrationChecksum(migration: Migration): Promise<string> {
  if (callbackOnly(migration)) return sha256(callbackSource(migration, normalizeSource));
  return digestEvidence({ name: migration.name, replaces: migration.replaces ?? [], operations: migration.operations,
    up: migration.up ? Function.prototype.toString.call(migration.up) : null,
    down: migration.down ? Function.prototype.toString.call(migration.down) : null });
}

/** Whether a stored checksum matches, accepting the raw-source hash older releases stored for callback migrations. */
export async function checksumMatches(migration: Migration, stored: string, current: string): Promise<boolean> {
  if (stored === current) return true;
  return callbackOnly(migration) && stored === await sha256(callbackSource(migration, (source) => source));
}
