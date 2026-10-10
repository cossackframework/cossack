/** Supported content metadata. Extension fields need an explicit processor validator. */
export interface StandardMarkdownFrontmatter {
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date?: string;
  locale?: string;
  canonical?: string;
  aliases?: readonly string[];
  ssg?: boolean;
}
export type MarkdownFrontmatter<Extensions extends object = Record<never, never>> =
  StandardMarkdownFrontmatter & Partial<Extensions>;
export type MarkdownFrontmatterValidator<T> = (value: unknown) => value is T;
export type MarkdownFrontmatterExtensions<Extensions extends object> = {
  [Key in keyof Extensions]: Key extends keyof StandardMarkdownFrontmatter ? never : MarkdownFrontmatterValidator<Extensions[Key]>;
};
export interface MarkdownFrontmatterOptions<Extensions extends object = Record<never, never>> {
  filename?: string;
  source?: string;
  extensions?: MarkdownFrontmatterExtensions<Extensions>;
}
export interface MarkdownFrontmatterDiagnostic {
  code: 'COSSACK_MARKDOWN_FRONTMATTER_INVALID' | 'COSSACK_MARKDOWN_FRONTMATTER_UNKNOWN_FIELD';
  field: string;
  source: { file: string; line: number; column: number };
  expected: string;
}
export class MarkdownFrontmatterError extends Error {
  readonly diagnostics: readonly MarkdownFrontmatterDiagnostic[];
  constructor(diagnostics: readonly MarkdownFrontmatterDiagnostic[]) {
    const first = diagnostics[0];
    super(`${first.code}: ${first.source.file}:${first.source.line}:${first.source.column}: frontmatter ${first.field} must be ${first.expected}.`);
    this.name = 'MarkdownFrontmatterError';
    this.diagnostics = diagnostics;
  }
}
const validated = new WeakSet<object>();
/** Proof that this immutable metadata passed the shared standard and extension checks. */
export function isValidatedMarkdownFrontmatter(value: unknown): value is MarkdownFrontmatter<Record<string, unknown>> {
  return !!value && typeof value === 'object' && validated.has(value);
}
const STANDARD = new Set(['title', 'description', 'image', 'author', 'date', 'locale', 'canonical', 'aliases', 'ssg']);
const identifier = (name: string) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
  && !['__proto__', 'constructor', 'prototype'].includes(name);
function sourceLocation(field: string, options: MarkdownFrontmatterOptions<any>) {
  const lines = (options.source ?? '').split(/\r\n|\n|\r/);
  if (lines[0] === '---') {
    for (let index = 1; index < lines.length && lines[index] !== '---'; index++) {
      const match = lines[index].match(/^(\s*)(?:([A-Za-z_][A-Za-z0-9_]*)|"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)')\s*:/);
      if (match && [match[2], match[3], match[4]].includes(field)) return { file: options.filename ?? '<markdown>', line: index + 1, column: match[1].length + 1 };
    }
  }
  return { file: options.filename ?? '<markdown>', line: 1, column: 1 };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function isMarkdownRoutePath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\?#\u0000-\u0020]/.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !/[\\?#\u0000-\u0020]/.test(decoded) && !decoded.startsWith('//')
      && !decoded.split('/').some(part => part === '.' || part === '..' || part.startsWith(':') || /[\[\]*]/.test(part));
  } catch { return false; }
}
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isCanonical(value: string): boolean {
  if (isMarkdownRoutePath(value)) return true;
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
/** Validate parser output without reading accessors or including rejected values in diagnostics. */
export function validateMarkdownFrontmatter<Extensions extends object = Record<never, never>>(
  value: unknown,
  options: MarkdownFrontmatterOptions<Extensions> = {},
): MarkdownFrontmatter<Extensions> {
  const diagnostics: MarkdownFrontmatterDiagnostic[] = [];
  const reject = (field: string, expected: string, unknown = false) => diagnostics.push({
    code: unknown ? 'COSSACK_MARKDOWN_FRONTMATTER_UNKNOWN_FIELD' : 'COSSACK_MARKDOWN_FRONTMATTER_INVALID',
    field: identifier(field) ? field : '<metadata>', source: sourceLocation(field, options), expected,
  });
  const result: Record<string, unknown> = Object.create(null);
  try {
    if (!isRecord(value) || Object.getOwnPropertySymbols(value).length) {
      reject('<metadata>', 'an object with named metadata fields');
    } else {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const extensions = options.extensions ?? {};
      const extensionDescriptors = Object.getOwnPropertyDescriptors(extensions);
      if (Object.keys(descriptors).length > 256) reject('<metadata>', 'at most 256 metadata fields');
      for (const [name, descriptor] of Object.entries(extensionDescriptors)) {
        if (!identifier(name) || STANDARD.has(name) || !('value' in descriptor) || typeof descriptor.value !== 'function') reject(name, 'a distinct named extension validator');
      }
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (!identifier(name) || !('value' in descriptor)) { reject(name, 'a named data field'); continue; }
        const entry = descriptor.value;
        if (STANDARD.has(name)) {
          if (name === 'ssg') {
            if (typeof entry !== 'boolean') reject(name, 'a boolean'); else result[name] = entry;
          } else if (name === 'aliases') {
            if (!Array.isArray(entry) || entry.length > 256) reject(name, 'an array of static root-relative route paths');
            else {
              const items = Object.getOwnPropertyDescriptors(entry);
              const paths: string[] = [];
              let valid = true;
              for (let index = 0; index < entry.length; index++) {
                const item = items[String(index)];
                if (!item || !('value' in item) || !isMarkdownRoutePath(item.value) || item.value.includes('%')) { valid = false; break; }
                paths.push(item.value);
              }
              if (!valid) reject(name, 'an array of unencoded static root-relative route paths');
              else if (new Set(paths.map(route => route.replace(/\/+$/, '') || '/')).size !== paths.length) reject(name, 'distinct static output paths after trailing-slash normalization');
              else result[name] = Object.freeze(paths);
            }
          } else if (typeof entry !== 'string') reject(name, 'a string');
          else if (name === 'date' && !isDate(entry)) reject(name, 'a valid ISO calendar date (YYYY-MM-DD)');
          else if (name === 'locale' && (entry.length > 64 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(entry))) reject(name, 'a language tag such as en or es-MX');
          else if (name === 'canonical' && !isCanonical(entry)) reject(name, 'an HTTP(S) URL or root-relative route path without credentials or fragment');
          else result[name] = entry;
        } else {
          const extension = extensionDescriptors[name];
          if (!extension || !('value' in extension) || typeof extension.value !== 'function') reject(name, 'a declared extension field', true);
          else {
            let valid = false;
            try { valid = extension.value(entry) === true; } catch { /* callback details are private */ }
            if (!valid) reject(name, 'a value accepted by its extension validator'); else result[name] = entry;
          }
        }
      }
    }
  } catch { reject('<metadata>', 'a readable metadata object'); }
  if (result.aliases !== undefined && result.ssg === false) reject('aliases', 'static output aliases on an SSG-enabled Markdown page');
  if (diagnostics.length) throw new MarkdownFrontmatterError(diagnostics);
  Object.freeze(result);
  validated.add(result);
  return result as MarkdownFrontmatter<Extensions>;
}
