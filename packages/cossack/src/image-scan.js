/**
 * Pure helpers for scanning source files for `<Image>` component usages and
 * resolving output variant paths. Used by `cossack image:optimize`.
 *
 * All functions are pure (string in, value out) so they are trivially testable.
 */

/**
 * Extract `Image({ ... })` call props from a source string.
 *
 * Finds each `Image(` invocation and balances the following `{ }` to capture
 * the props object, then extracts the recognized fields. Handles single- and
 * double-quoted strings, template literals, and numeric literals.
 *
 * @param {string} source
 * @returns {Array<{ src?: string; width?: number; height?: number; quality?: number; format?: string }>}
 */
export function extractImageCalls(source) {
  const results = [];
  if (!source || typeof source !== 'string') return results;

  const needle = /(^|[^\w$])Image\s*\(\s*\{/g;
  let m;
  while ((m = needle.exec(source)) !== null) {
    // Find the opening brace of the props object (right after `Image(`).
    const openIdx = source.indexOf('{', m.index + m[0].length - 1);
    if (openIdx === -1) continue;

    const slice = balanceBraces(source, openIdx);
    if (!slice) continue;

    const props = parseProps(slice);
    if (props && (props.src || props.width || props.height)) {
      results.push(props);
    }
  }
  return results;
}

/**
 * Balance `{ }` starting at `start` (which must point at `{`). Returns the
 * substring from `{` to the matching `}` inclusive, or null if unbalanced.
 * Ignores braces inside string/char/template literals.
 */
function balanceBraces(source, start) {
  let depth = 0;
  let i = start;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/** Parse the recognized props from a `{ ... }` object literal string. */
function parseProps(objLiteral) {
  const props = {};
  // src: "..." | '...' | `...`
  const srcMatch = objLiteral.match(/\bsrc\s*:\s*(['"`])(.*?)\1/);
  if (srcMatch) props.src = srcMatch[2];
  const widthMatch = objLiteral.match(/\bwidth\s*:\s*(\d+)/);
  if (widthMatch) props.width = Number(widthMatch[1]);
  const heightMatch = objLiteral.match(/\bheight\s*:\s*(\d+)/);
  if (heightMatch) props.height = Number(heightMatch[1]);
  const qualityMatch = objLiteral.match(/\bquality\s*:\s*(\d+)/);
  if (qualityMatch) props.quality = Number(qualityMatch[1]);
  const formatMatch = objLiteral.match(/\bformat\s*:\s*['"](\w+)['"]/);
  if (formatMatch) props.format = formatMatch[1];
  return props;
}

/**
 * Whether a `src` refers to a local asset (vs. a remote URL or data URI).
 * Local sources are the only ones `image:optimize` can process.
 */
export function isLocalSource(src) {
  if (!src || typeof src !== 'string') return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (/^data:/i.test(src)) return false;
  if (/^\/cdn-cgi\//i.test(src)) return false;
  return true;
}

/**
 * Resolve the output variant path for an optimized image.
 *   `/img/foo.png` + 600x400 + webp -> `/img/foo-600x400.webp`
 *   `/a.jpg` + 200 + webp           -> `/a-200.webp`
 *   `foo.png` (no leading slash)    -> `foo-600x400.webp`
 * Only width is required; height may be omitted.
 */
export function resolveOutputPath(src, width, height, format) {
  const ext = format || 'webp';
  const slashIdx = src.lastIndexOf('/');
  const leadingSlash = src.startsWith('/');
  const dir = slashIdx > 0 ? src.slice(0, slashIdx) : '';
  const file = slashIdx >= 0 ? src.slice(slashIdx + 1) : src;
  const dotIdx = file.lastIndexOf('.');
  const base = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  const size = height ? `${width}x${height}` : `${width}`;
  const name = `${base}-${size}.${ext}`;
  const joined = dir ? `${dir}/${name}` : name;
  return leadingSlash && !joined.startsWith('/') ? `/${joined}` : joined;
}
