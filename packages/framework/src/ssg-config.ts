/**
 * SSG config reader.
 *
 * Resolves the site base URL used for sitemap generation and canonical URLs.
 * The resolution is performed without any external dependencies so it can be
 * reused by both the framework's own SSG script and the `create-cossack-app`
 * template.
 *
 * Resolution order (first match wins):
 *   1. process.env.APP_URL                     — explicit shell/CI override
 *   2. wrangler.jsonc -> vars.APP_URL
 *   3. wrangler.toml  -> [vars] APP_URL
 *   4. .env            -> APP_URL
 *   5. DEFAULT_SITE_URL                        — final fallback
 */

import { createRequire } from 'node:module';
import * as path from 'node:path';

/**
 * Obtain the real Node.js `fs`. The framework's vitest configuration inherits
 * the Cloudflare SSR/Workers environment, which replaces `node:fs` with an
 * unenv shim that does not implement the file system. Going through
 * `createRequire` bypasses Vite's SSR resolver so we get the real Node.js
 * built-in.
 */
const require = createRequire(import.meta.url);
const fs: typeof import('node:fs') = require('node:fs');

export const DEFAULT_SITE_URL = 'https://example.com';

export interface GetSiteUrlOptions {
  /** Project root to resolve config files from. Defaults to process.cwd(). */
  projectRoot?: string;
}

/**
 * Resolve the site base URL from environment, wrangler config, and .env.
 * Always returns a non-empty string.
 */
export function getSiteUrl(options?: GetSiteUrlOptions): string {
  const root = options?.projectRoot ?? process.cwd();

  // 1. Explicit shell/CI override (highest precedence).
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }

  // 2. wrangler.jsonc
  const fromJsonc = readWranglerJsonc(root);
  if (fromJsonc) return fromJsonc;

  // 3. wrangler.toml
  const fromToml = readWranglerToml(root);
  if (fromToml) return fromToml;

  // 4. .env -> APP_URL
  const dotEnv = readDotEnv(root);
  if (dotEnv.APP_URL) {
    return dotEnv.APP_URL;
  }

  // 5. Final fallback
  return DEFAULT_SITE_URL;
}

/**
 * Strip JSONC comments (`//` and `/* *​/`) and trailing commas while preserving
 * string literals, so the result can be fed to `JSON.parse`. Trailing commas
 * are legal JSONC but rejected by `JSON.parse`. No external dependencies.
 */
function stripJsonComments(str: string): string {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < str.length) {
    const ch = str[i];
    const next = str[i + 1];

    // Inside a string: copy through until the closing unescaped quote.
    if (inString) {
      // Backslash escape — copy both chars so escaped quotes are preserved.
      if (ch === '\\') {
        result += ch + (next ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      result += ch;
      i += 1;
      continue;
    }

    // Not in a string.
    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }

    // Trailing comma: drop if the next non-whitespace char is `}` or `]`.
    if (ch === ',') {
      let j = i + 1;
      while (
        j < str.length &&
        (str[j] === ' ' || str[j] === '\t' || str[j] === '\n' || str[j] === '\r')
      ) {
        j += 1;
      }
      if (j < str.length && (str[j] === '}' || str[j] === ']')) {
        i += 1; // skip the comma; whitespace is emitted normally below
        continue;
      }
    }

    // Line comment
    if (ch === '/' && next === '/') {
      // Skip to end of line.
      while (i < str.length && str[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) {
        i += 1;
      }
      i += 2; // skip closing */
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

/**
 * Read `vars.APP_URL` from `wrangler.jsonc` at the given root.
 * Returns the value or `undefined` if not present / file missing / parse error.
 */
function readWranglerJsonc(root: string): string | undefined {
  const filePath = path.join(root, 'wrangler.jsonc');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(content));
  } catch {
    return undefined;
  }

  if (parsed && typeof parsed === 'object') {
    const vars = (parsed as { vars?: unknown }).vars;
    if (vars && typeof vars === 'object') {
      const value = (vars as Record<string, unknown>).APP_URL;
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Read `APP_URL` from the `[vars]` table of `wrangler.toml` at the given root.
 * Minimal TOML parser — only handles the `vars` table and quoted/unquoted
 * scalar values, which is all we need for this config. Returns the value or
 * `undefined` if not present / file missing.
 */
function readWranglerToml(root: string): string | undefined {
  const filePath = path.join(root, 'wrangler.toml');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }

  const value = parseTomlVars(content);
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * Extract `APP_URL` from the `[vars]` table of TOML content.
 * Strips `#` line comments and supports quoted (`"..."`/`'...'`) and bare
 * scalar values.
 */
function parseTomlVars(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  let inVarsTable = false;

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (line === '') continue;

    // Table header — track whether we're inside [vars].
    if (line.startsWith('[') && line.endsWith(']')) {
      const header = line.slice(1, -1).trim();
      inVarsTable = header === 'vars';
      continue;
    }

    if (!inVarsTable) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key !== 'APP_URL') continue;

    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return undefined;
}

/**
 * Remove a `#` comment from a TOML line, respecting quoted strings.
 */
function stripTomlComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inDouble && !inSingle) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Parse a `.env` file into a flat key/value map.
 * Handles `KEY=VALUE`, surrounding quotes, and skips blank/`#`-comment lines.
 * No dependency on `dotenv`.
 */
function parseDotEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip inline `#` comment only when value is unquoted.
    if (
      (value.startsWith('"') && !value.endsWith('"')) ||
      (value.startsWith("'") && !value.endsWith("'"))
    ) {
      // Mismatched quote — leave value as-is.
    } else if (value.startsWith('"') || value.startsWith("'")) {
      // Quoted value — strip the quotes.
      value = value.slice(1, -1);
    } else {
      // Bare value — strip an inline `#` comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) {
        value = value.slice(0, hash).trim();
      }
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Read `.env` from the given root and return its key/value map.
 * Returns an empty object if the file is missing or unreadable.
 */
function readDotEnv(root: string): Record<string, string> {
  const filePath = path.join(root, '.env');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return {};
  }
  return parseDotEnvFile(content);
}
