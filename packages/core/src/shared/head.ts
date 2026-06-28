/**
 * Known HTML tag names that can appear in the document `<head>`.
 *
 * The `(string & {})` term lets developers write `head()` overrides without
 * an explicit `: HeadValue` return type annotation: TypeScript widens
 * `{ tag: 'meta' }` to `{ tag: string }` during inference, which would fail
 * against the literal union alone. Intersecting with `{}` preserves
 * autocomplete for the known names while accepting any string. The runtime
 * switch in {@link buildHeadContext} routes only the recognized tags;
 * anything else falls to the `default` branch.
 */
export type HeadTagName = 'title' | 'meta' | 'link' | 'script' | 'style' | 'base' | (string & {});

export interface HeadTag {
    tag: HeadTagName;
    /**
     * Arbitrary HTML attributes. `undefined` is intentionally permitted in the
     * value type so that a single `meta`/`links` array can hold tags with
     * different attribute shapes (e.g. a `meta` with `name`/`content` next to a
     * `link` with `rel`/`href`): TypeScript models the union by adding
     * `?: undefined` for the absent keys, which must remain assignable to the
     * index signature.
     */
    attributes?: Record<string, string | number | boolean | undefined>;
    children?: string;
}

export interface HeadContext {
  title: string;
  description: string;
  image: string;
  meta: HeadTag[];
  links: HeadTag[];
  scripts: HeadTag[];
  tags: HeadTag[];
}

export interface HeadValue {
  title?: string;
  description?: string;
  image?: string;
  /** `<meta>` tags. Appended to any tags accumulated from child components. */
  meta?: HeadTag[];
  /** `<link>` tags (favicon, canonical, stylesheets, preconnect…). Appended to child tags. */
  links?: HeadTag[];
  /** `<script>` tags. Appended to child tags. */
  scripts?: HeadTag[];
  /** Any other head tags (`<style>`, `<base>`, …). Appended to child tags. */
  tags?: HeadTag[];
}

/**
 * Build a HeadContext from an array of existing HeadTags.
 * Extracts title, description, and image shortcuts from well-known meta tags.
 */
export function buildHeadContext(tags: HeadTag[]): HeadContext {
  const context: HeadContext = {
    title: '',
    description: '',
    image: '',
    meta: [],
    links: [],
    scripts: [],
    tags: [],
  };

  for (const tag of tags) {
    switch (tag.tag) {
      case 'title':
        context.title = tag.children || '';
        break;
      case 'meta':
        const name = tag.attributes?.name || tag.attributes?.property;
        if (name === 'description' || name === 'og:description') {
          context.description = String(tag.attributes?.content || '');
        } else if (name === 'og:image' || name === 'twitter:image') {
          context.image = String(tag.attributes?.content || '');
        }
        context.meta.push(tag);
        break;
      case 'link':
        context.links.push(tag);
        break;
      case 'script':
        context.scripts.push(tag);
        break;
      default:
        context.tags.push(tag);
        break;
    }
  }

  return context;
}

/**
 * Merge a HeadValue into an existing HeadContext and produce a HeadTag array.
 * Auto-expands SEO shortcuts (description, image) into OG/Twitter meta tags.
 *
 * Category semantics:
 * - `title`, `description`, `image`: the child value wins unless the parent
 *   overrides it (`value.x ?? context.x`).
 * - `meta`, `links`, `scripts`, `tags`: **accumulate inside-out** — the child's
 *   tags are kept and the parent's tags are appended. This lets a root `App`
 *   contribute global tags (e.g. font `<link>`s) without discarding
 *   page-specific tags such as a canonical link.
 */
export function mergeHead(context: HeadContext, value: HeadValue): HeadTag[] {
  const title = value.title ?? context.title;

  // Array categories accumulate (child first, parent appended).
  const meta = [...context.meta, ...(value.meta ?? [])];
  const links = [...context.links, ...(value.links ?? [])];
  const scripts = [...context.scripts, ...(value.scripts ?? [])];
  const tags = [...context.tags, ...(value.tags ?? [])];

  if (isDevMode()) {
    warnIfMisplaced('meta', value.meta, ['meta']);
    warnIfMisplaced('links', value.links, ['link']);
  }

  const result: HeadTag[] = [];
  if (title) result.push({ tag: 'title', children: title });

  // Auto-expand SEO shortcuts ONLY when declared at this level
  // (value.description / value.image). Expanding inherited values (already
  // represented in the accumulated arrays via buildHeadContext) would
  // duplicate tags at every merge level.
  if (value.description) {
    result.push({ tag: 'meta', attributes: { name: 'description', content: value.description } });
    result.push({ tag: 'meta', attributes: { property: 'og:description', content: value.description } });
  }
  if (value.image) {
    result.push({ tag: 'meta', attributes: { property: 'og:image', content: value.image } });
    result.push({ tag: 'meta', attributes: { name: 'twitter:image', content: value.image } });
  }

  result.push(...meta);
  result.push(...links);
  result.push(...scripts);
  result.push(...tags);
  return result;
}

function isDevMode(): boolean {
  try {
    const env = (globalThis as any).process?.env?.NODE_ENV;
    return typeof env === 'string' && env !== 'production';
  } catch {
    return false;
  }
}

/**
 * Warns (once per offending shape) when a head category receives tags that
 * belong in a different category — e.g. a `{ tag: 'link' }` placed in `meta`.
 * The tag still renders correctly, but using the right category keeps head
 * management predictable.
 */
const warnedShapes = new WeakSet<object>();
function warnIfMisplaced(category: string, tags: HeadTag[] | undefined, expected: string[]): void {
  if (!tags || tags.length === 0) return;
  for (const tag of tags) {
    if (expected.includes(tag.tag)) continue;
    if (warnedShapes.has(tag)) continue;
    warnedShapes.add(tag);
    const suggestion = tag.tag === 'link' ? 'links' : tag.tag === 'script' ? 'scripts' : 'meta';
    // eslint-disable-next-line no-console
    console.warn(
      `[cossack/head] A { tag: '${tag.tag}' } was returned in the \`${category}\` array. ` +
        `Move it to the \`${suggestion}\` array for predictable head management.`,
    );
  }
}

/**
 * Apply a list of HeadTags to document.head (client-side only).
 * Replaces all previously managed tags (marked with `data-cossack`).
 */
export function applyHeadTags(tags: HeadTag[]): void {
  const headElement = document.head;

  // Clear existing managed tags
  headElement.querySelectorAll('[data-cossack]').forEach((el) => el.remove());

  for (const tag of tags) {
    if (tag.tag === 'title') {
      if (tag.children) document.title = tag.children;
      continue;
    }
    const el = document.createElement(tag.tag);
    el.setAttribute('data-cossack', '');
    if (tag.attributes) {
      for (const [key, value] of Object.entries(tag.attributes)) {
        el.setAttribute(key, String(value));
      }
    }
    if (tag.children) {
      el.textContent = tag.children;
    }
    headElement.appendChild(el);
  }
}
