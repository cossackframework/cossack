/**
 * Pure string helpers for deriving file/class/export names from CLI input.
 *
 * Input forms we accept:
 *   "my-page"            single name (kebab or Pascal)
 *   "/dashboard/foo"     explicit nested path under src/pages (leading slash)
 *   "UserWidget"         already PascalCase
 *   "my-page.md"         name + explicit extension
 *
 * Conventions (mirrored from the framework's own source):
 *   page dirs/layouts : kebab-case        (stateless-counter, (auth))
 *   components        : PascalCase files  (Button.ts)
 *   services          : PascalCase files  (CounterService.ts)
 *   middleware files  : kebab-case        (logging.ts), camelCase export (loggingMiddleware)
 */

const SEG_SPLIT = /[/\\]+/;

/** Split a raw input into path segments + leaf + extension. */
export function parseName(raw) {
  if (raw == null) return { segments: [], leaf: '', name: '', ext: '' };
  const normalized = String(raw).replace(/\\/g, '/');
  const segments = normalized.split(SEG_SPLIT).filter(Boolean);
  const leafWithExt = segments.length ? segments[segments.length - 1] : normalized;
  const extMatch = leafWithExt.match(/(\.[a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1] : '';
  const leaf = ext ? leafWithExt.slice(0, -ext.length) : leafWithExt;
  const pathSegments = segments.slice(0, -1).map(toKebab);
  return {
    segments: pathSegments,
    leaf,
    name: leaf,
    ext: ext.toLowerCase(),
    hasLeadingSlash: normalized.startsWith('/'),
  };
}

/** kebab-case: "UserWidget" / "user_widget" / "user widget" -> "user-widget". */
export function toKebab(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}

/** PascalCase: "my-page" / "user_widget" -> "MyPage". */
export function toPascal(s) {
  return String(s || '')
    .split(/[-_\s/.]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** camelCase: "my-page" -> "myPage". */
export function toCamel(s) {
  const p = toPascal(s);
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : p;
}

/**
 * Resolve a page target from a raw input under `src/pages`.
 * Returns an absolute-ish project-relative path and class name parts.
 *
 *   "my-page"           -> { dir: "src/pages/my-page", file: "index", full: "src/pages/my-page/index", ext: ".ts" }
 *   "/dashboard/foo"    -> { dir: "src/pages/dashboard/foo", ... }
 *   "MyPage.md"         -> ext: ".md"
 */
export function resolvePageTarget(raw, { defaultExt = '.ts' } = {}) {
  const parsed = parseName(raw);
  const ext = parsed.ext || defaultExt;
  const leafDir = toKebab(parsed.leaf) || 'page';
  const dir = ['src/pages', ...parsed.segments, leafDir].join('/');
  const pascal = toPascal(parsed.leaf || 'page');
  return {
    dir,
    file: 'index',
    full: `${dir}/index`,
    ext,
    className: `${pascal}Page`,
    pascal,
    kebab: toKebab(parsed.leaf),
  };
}

/** Resolve a standalone file target (components / services / middleware). */
export function resolveFileTarget(raw, baseDir, { suffix = '', pascal = true } = {}) {
  const parsed = parseName(raw);
  const ext = parsed.ext || '.ts';
  const leaf = parsed.leaf;
  const fileName = pascal ? `${toPascal(leaf)}${suffix}` : `${toKebab(leaf)}${suffix}`;
  const dir = ['src', baseDir, ...parsed.segments].filter(Boolean).join('/');
  const full = `${dir}/${fileName}`;
  return {
    dir,
    file: fileName,
    full,
    ext,
    pascal: toPascal(leaf),
    camel: toCamel(leaf),
    kebab: toKebab(leaf),
  };
}

/**
 * `YYYY_MM_DD_HHMMSS` timestamp for migration file prefixes. Padded so files
 * sort chronologically. `d` defaults to now (injectable for tests).
 */
export function migrationTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/**
 * Resolve a migration file target: `src/migrations/<timestamp>_<snake>.ts`.
 * The name is snake_cased to match the default migration naming
 * (`0001_create_users.ts`). `timestamp` is injectable for deterministic tests.
 */
export function resolveMigrationTarget(raw, timestamp = migrationTimestamp()) {
  const parsed = parseName(raw);
  const snake = toKebab(parsed.leaf || 'migration').replace(/-/g, '_');
  const dir = ['src', 'migrations', ...parsed.segments].filter(Boolean).join('/');
  const fileName = `${timestamp}_${snake}.ts`;
  return {
    dir,
    file: fileName,
    full: `${dir}/${fileName}`,
    ext: '.ts',
    kebab: snake,
    timestamp,
  };
}
