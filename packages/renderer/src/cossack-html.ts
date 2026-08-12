import { ComponentResult, isComponentResult } from './component';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { LiveResult, RepeatResult, KeyResult, BindResult, PreventDefaultResult, IfDefinedResult, GuardResult, CacheResult, resolveField, setField } from './directives';

export type TemplateResultType = 1 | 2;

export class TemplateResult<T extends TemplateResultType = TemplateResultType> {
  public readonly _cossack_template_result = true;
  public readonly '_$litType$': T;
  constructor(
    public readonly strings: TemplateStringsArray,
    public readonly values: unknown[],
    litType: T = 1 as T,
  ) {
    this['_$litType$'] = litType;
  }

  /** Component that created this template. Used for Light DOM style ownership. */
  public __cossackOwner?: CossackElement;
  /** Scope applied only to elements statically owned by this template. */
  public __cossackScope?: string;
}

export type SVGTemplateResult = TemplateResult<2>;

export const html = (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<1> => {
  const result = new TemplateResult(strings, values, 1);
  const owner = CossackElement.currentRenderingInstance;
  if (owner) {
    result.__cossackOwner = owner;
    result.__cossackScope = owner._getStyleScopeId();
  }
  return result;
};

export const svg = (strings: TemplateStringsArray, ...values: unknown[]): SVGTemplateResult => {
  const result = new TemplateResult(strings, values, 2);
  const owner = CossackElement.currentRenderingInstance;
  if (owner) {
    result.__cossackOwner = owner;
    result.__cossackScope = owner._getStyleScopeId();
  }
  return result;
};

/** Lit-compatible sentinel that removes the value in its binding context. */
export const nothing: unique symbol = Symbol.for('cossack-nothing');

export type ValueSanitizer = (value: unknown) => unknown;
export type SanitizerFactory = (
  node: Node,
  name: string,
  type: 'property' | 'attribute',
) => ValueSanitizer;

export const component = <T extends CossackElement>(
  clazz: new () => T,
  props?: T['props'] & Record<string, unknown>,
  children?: unknown,
): TemplateResult<1> => {
  const raw: ComponentResult = {
    _type: 'COMPONENT',
    clazz,
    props: props ?? {},
    children,
    parent: CossackElement.currentRenderingInstance,
  };
  return html`${raw}`;
};

export const isTemplateResult = (value: unknown): value is TemplateResult => {
  return typeof value === 'object' && value !== null && (value as any)._cossack_template_result === true;
};

const UNSAFE_HTML_BRAND = Symbol.for('@cossackframework/renderer/unsafe-html');

export class UnsafeHTMLResult {
  readonly [UNSAFE_HTML_BRAND] = true;
  constructor(public readonly value: string) {}
}

export const unsafeHTML = (value: string) => new UnsafeHTMLResult(value);

export const isUnsafeHTML = (value: unknown): value is UnsafeHTMLResult => {
  return typeof value === 'object' && value !== null &&
    (value as Record<PropertyKey, unknown>)[UNSAFE_HTML_BRAND] === true;
};

// --- SSR Implementation ---

export const escapeHtml = (unsafe: unknown): string => {
  const str = String(unsafe);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const valueToString = (value: unknown, opts: { hydrate?: boolean } = {}): string => {
  if (value === nothing || value === '' || value === null || value === undefined || value === false) {
    return '';
  }
  if (Array.isArray(value)) {
    // Wrap each item in CSA start/end markers when emitting hydratable SSR,
    // so the client can split the rendered items and adopt each one in place
    // instead of rebuilding the whole list.
    if (opts.hydrate) {
      return value.map((v) => `<!--CSA-S-->${valueToString(v, opts)}<!--CSA-E-->`).join('');
    }
    return value.map((v) => valueToString(v, opts)).join('');
  }
  if (isTemplateResult(value)) {
    return renderToString(value, opts);
  }
  if (value instanceof LiveResult) {
    return valueToString(value.value, opts);
  }
  if (value instanceof RepeatResult) {
    if (opts.hydrate) {
      return value.items
        .map((item, i) => `<!--CSA-S-->${valueToString(value.templateFn(item, i), opts)}<!--CSA-E-->`)
        .join('');
    }
    return value.items.map((item, i) => valueToString(value.templateFn(item, i), opts)).join('');
  }
  if (value instanceof KeyResult) {
    // SSR has no previous DOM, so key is transparent: just render the template.
    return valueToString(value.template, opts);
  }
  if (value instanceof GuardResult) {
    // SSR has no cross-render state, so always evaluate the factory once and
    // render its result. Memoization is a client-only optimization.
    return valueToString(value.factory(), opts);
  }
  if (value instanceof CacheResult) {
    // SSR is stateless, so caching is transparent: just render the inner value.
    return valueToString(value.value, opts);
  }
  if (value instanceof BindResult) {
    // SSR for two-way binding: emit the current field value. The DOM property
    // name (value/checked) is determined by the attribute this BindResult is
    // attached to, which the SSR scanner handles via its `.startsWith('.')`
    // branch and calls valueToString here. Writeback listeners are a
    // client-only concern. Dot-paths resolve via property access.
    const current = resolveField(value.component, value.fieldName);
    return valueToString(current, opts);
  }
  if (isComponentResult(value)) {
    const instance = new value.clazz();
    Object.assign(instance, value.props);
    if ('props' in instance) {
      (instance as any).props = value.props;
    }
    instance.children = value.children;
    instance.__parent = value.parent || CossackElement.currentRenderingInstance;
    if (value.serviceScope && typeof (instance as any)._setServiceScope === 'function') {
      (instance as any)._setServiceScope(value.serviceScope);
    }

    // Set up _id for nested components (same logic as updateComponent)
    if (instance.__parent) {
      instance._id = `${instance.__parent._id}:${(instance.__parent as any)._childCounter++}`;
    }

    // Call connectedCallback to register the component (needed for activeComponents)
    instance.connectedCallback();

    pushCurrentInstance(instance);
    (instance as any).willUpdate(new Map());
    const template = instance._finalizeRenderOutput(instance.render());
    let res = '';
    if (template) {
      if (isTemplateResult(template)) {
        res = renderToString(template, opts);
      } else {
        res = renderToString(html`${template}`, opts);
      }
    }
    popCurrentInstance();
    return res;
  }
  if (isUnsafeHTML(value)) {
    return value.value;
  }
  if (typeof value === 'function') {
    return '';
  }
  // Handle RefObject (object with .value property used for refs)
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return '';
  }
  return escapeHtml(value);
};

// HTML attributes that serialize as presence attributes (emit the bare name
// when truthy, omit when falsy) rather than name="value". Shared by the SSR
// spread path (renderSpread) and the SSR direct property-binding path so the
// two stay in sync.
const BOOLEAN_ATTRS = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
  'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
  'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

const serializeBooleanAttribute = (name: string, value: boolean): string | null => {
  if (BOOLEAN_ATTRS.has(name.toLowerCase())) return value ? '' : null;
  return String(value);
};

/**
 * Mutable accumulator that `renderSpread` writes into. Normal spread
 * attributes are appended to `result`; a caller-supplied `class`/`className`
 * is merged into an existing `class="..."` on the current open tag by
 * rewriting `result` in place. Passing a holder (rather than returning a
 * string) lets the class-merge coexist with other keys in the same spread
 * object regardless of key order.
 */
interface SpreadRenderContext {
  result: string;
}

const renderSpread = (obj: unknown, ctx: SpreadRenderContext): void => {
  if (obj === nothing || typeof obj !== 'object' || obj === null) return;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) continue;

    let name = k;
    let val = v;

    if (k.startsWith('?')) {
      if (v !== nothing && v) ctx.result += ` ${k.slice(1)}`;
      continue;
    }
    if (k.startsWith('.')) {
      name = k.slice(1);
      // Unwrap result-wrapper directives routed through the spread (e.g.
      // component(Input, { '.value': bind(this, 'name') }) or
      // { '.value': live(x) }) so SSR emits the underlying value instead of
      // "[object Object]". Mirrors the direct SSR .value branch. Boolean-ish
      // attrs (.checked/.disabled) render as presence attributes.
      if (val instanceof BindResult) {
        val = resolveField(val.component, val.fieldName);
      } else if (val instanceof LiveResult) {
        val = val.value;
      }
      if (val === nothing) {
        continue;
      }
      if (BOOLEAN_ATTRS.has(name)) {
        if (val) ctx.result += ` ${name}`;
        continue;
      }
    }

    // `class` / `className` merging: when a component template already has a
    // literal `class="..."` AND the spread also carries a `class` prop (e.g.
    // component(Card, { class: 'w-full' })), merge the caller's classes into
    // the existing attribute instead of emitting a second `class` (browsers
    // keep only the first, dropping one set). The merge rewrites `ctx.result`
    // in place, so it composes correctly even when `class` is not the first
    // key in the spread (earlier keys have already been appended to result).
    if ((name === 'class' || name === 'className') && typeof val === 'string' && val) {
      const merged = mergeClassIntoResult(ctx.result, val);
      if (merged !== null) {
        ctx.result = merged;
        continue;
      }
      // Merge failed (no double-quoted class attr found on the current tag).
      // This can happen if the template uses single-quoted `class='...'` or the
      // tag has no class attribute at all. The fallback below emits a fresh
      // `class="..."`, which may duplicate if a single-quoted class exists.
      // Warn in dev so this doesn't degrade silently.
      if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
        console.warn('[cossack/renderer] spread class merge failed — falling back to a separate class attribute. If the tag already has a class attribute, check that it uses double quotes.');
      }
    }

    if (val === nothing) {
      continue;
    } else if (val instanceof IfDefinedResult) {
      // `ifDefined` via the spread: drop only on undefined; render every other
      // value (incl. false/null/0/'') as a literal attribute string. Checked
      // before the `typeof val === 'boolean'` branch so `false` renders as
      // "false".
      if (val.value !== undefined) {
        ctx.result += ` ${name}="${escapeHtml(String(val.value))}"`;
      }
    } else if (typeof val === 'boolean') {
      const serialized = serializeBooleanAttribute(name, val);
      if (serialized === '') ctx.result += ` ${name}`;
      else if (serialized !== null) ctx.result += ` ${name}="${serialized}"`;
    } else if (typeof val === 'function') {
      // Ignore
    } else if (val !== null && val !== undefined) {
      ctx.result += ` ${name}="${escapeHtml(val)}"`;
    }
  }
};

/**
 * Merge caller-supplied `extraClass` into an existing `class="..."` attribute
 * on the *current* (last) open tag in `result`. Returns the rewritten full
 * `result` string if an existing class attribute was found and merged, or
 * `null` if the current open tag has no class attribute to merge into (in
 * which case the caller emits a fresh attribute).
 *
 * The search is restricted to the substring after the final `<` so it only
 * ever touches the current open tag — never a class attribute belonging to a
 * previously-closed element or an ancestor (which would diverge from the
 * client, where `SpreadPart` only ever touches its own element).
 */
const mergeClassIntoResult = (result: string, extraClass: string): string | null => {
  const tagStart = result.lastIndexOf('<');
  const tagSlice = tagStart >= 0 ? result.slice(tagStart) : result;
  // Anchor on start-of-slice or whitespace (NOT \b: a word boundary would also
  // match `data-class="..."` / `:class="..."` since the hyphen is a boundary).
  // Allow `>`/`/>` as the suffix so `<div class="x">` merges correctly (the
  // class attribute is the last attribute before the tag close). Capture the
  // prefix whitespace and suffix so the replacement preserves surrounding chars
  // and doesn't concatenate adjacent attributes (id="x"class="...").
  // NOTE: only matches double-quoted `class="..."`. Single-quoted `class='...'`
  // is valid HTML but vanishingly rare in template literals (the SSR emitter
  // always uses double quotes), so it's not handled here.
  const match = tagSlice.match(/(^|\s)class="([^"]*)"(\s|\/?>|$)/);
  if (!match) return null;
  const prefix = match[1];
  const existing = match[2];
  const suffix = match[3];
  const extra = extraClass.trim();
  if (!extra) return result;
  const merged = existing ? `${existing} ${extra}` : extra;
  // Don't escape the merged class value: it's developer-controlled (component
  // props, not user input), and CSS class names can legitimately contain quotes
  // (e.g. Tailwind arbitrary values like `before:content-['hello']`). Escaping
  // would mangle those into `&#039;` and break the CSS selector. The existing
  // class text from the template is already raw (unescaped) HTML.
  const rewrittenTag = tagSlice.replace(match[0], `${prefix}class="${merged}"${suffix}`);
  return result.slice(0, tagStart) + rewrittenTag;
};

/**
 * Classify each value position (gap between `strings[i]` and `strings[i+1]`)
 * as a node position (`true`, child content) or an attribute position
 * (`false`, inside an element's opening tag).
 *
 * This mirrors the char-by-char tracking in `compileTemplate` and MUST stay
 * in sync with it: the SSR scanner uses this array to decide where to emit
 * hydratable node markers, and the client uses the same classification to
 * decide where to insert `<!--CRP_i-->` markers. Any divergence breaks the
 * lockstep hydration walk.
 */
const classifyPositions = (strings: readonly string[]): boolean[] => {
  const isNode: boolean[] = [];
  let isInsideTag = false;
  let insideAttrQuote: string | null = null;
  const attrMatch = /(\.\.\.|[.@?]?[a-zA-Z0-9_:-]+)=["']?$/;
  for (let i = 0; i < strings.length - 1; i++) {
    const str = strings[i];
    for (let j = 0; j < str.length; j++) {
      if (insideAttrQuote) {
        if (str[j] === insideAttrQuote) insideAttrQuote = null;
      } else if (isInsideTag && (str[j] === '"' || str[j] === "'")) {
        if (j > 0 && str[j - 1] === '=') {
          insideAttrQuote = str[j];
        }
      } else if (str[j] === '<' && str[j + 1] !== '!' && str[j + 1] !== '/') {
        isInsideTag = true;
      } else if (str[j] === '>') {
        isInsideTag = false;
      }
    }
    const match = str.match(attrMatch);
    isNode[i] = !(isInsideTag && (match || insideAttrQuote));
  }
  return isNode;
};

/**
 * Build markers that cannot collide with authored static template text.
 *
 * The markers exist only while template strings are joined for scanning and
 * are removed before parsing/serialization. Choosing a prefix absent from all
 * input strings preserves literal private-use characters (including strings
 * that resemble an older marker format) without requiring randomness.
 */
const createTemplateMarkers = (strings: readonly string[]) => {
  let sequence = 0;
  let prefix: string;
  do {
    prefix = `\uE000cossack:${sequence++}:`;
  } while (strings.some((value) => value.includes(prefix)));
  const suffix = ':\uE001';
  return {
    marker: (index: number): string => `${prefix}${index}${suffix}`,
    pattern: new RegExp(`${prefix}(\\d+)${suffix}`, 'g'),
  };
};

/** Add a scope attribute to static opening tags without touching nested values. */
const scopeTemplateStrings = (strings: TemplateStringsArray, scopeId?: string): readonly string[] => {
  if (!scopeId) return strings;
  const markers = createTemplateMarkers(strings);
  let source = '';
  for (let i = 0; i < strings.length; i++) {
    source += strings[i];
    if (i < strings.length - 1) source += markers.marker(i);
  }

  let output = '';
  let insideTag = false;
  let quote: string | null = null;
  let openingTag = '';
  let rawTextTag = '';
  for (let i = 0; i < source.length;) {
    if (rawTextTag) {
      const closing = `</${rawTextTag}`;
      if (source.slice(i, i + closing.length).toLowerCase() === closing) {
        rawTextTag = '';
      } else {
        output += source[i++];
        continue;
      }
    }
    if (!insideTag && source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const next = end < 0 ? source.length : end + 3;
      output += source.slice(i, next);
      i = next;
      continue;
    }
    if (!insideTag && source[i] === '<' && /[A-Za-z]/.test(source[i + 1] ?? '')) {
      let end = i + 2;
      while (end < source.length && !/[\s/>]/.test(source[end])) end++;
      openingTag = source.slice(i + 1, end).toLowerCase();
      output += source.slice(i, end);
      output += ` data-cossack-scope="${scopeId}"`;
      i = end;
      insideTag = true;
      continue;
    }
    const char = source[i++];
    output += char;
    if (insideTag) {
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        insideTag = false;
        if (/^(script|style|textarea|title)$/.test(openingTag)) rawTextTag = openingTag;
        openingTag = '';
      }
    }
  }

  const scoped: string[] = [];
  let last = 0;
  let marker: RegExpExecArray | null;
  while ((marker = markers.pattern.exec(output))) {
    scoped.push(output.slice(last, marker.index));
    last = marker.index + marker[0].length;
  }
  scoped.push(output.slice(last));
  return scoped;
};

interface NothingAttributeGroup {
  first: number;
  last: number;
  prefix: string;
  suffix: string;
}

/**
 * Find attributes containing one or more expressions. This lets SSR remove a
 * whole multi-expression attribute when any slot is `nothing`, even though
 * rendering otherwise streams through template strings from left to right.
 */
const findNothingAttributeGroups = (
  strings: readonly string[],
  values: readonly unknown[],
): Map<number, NothingAttributeGroup> => {
  const templateMarkers = createTemplateMarkers(strings);
  let source = '';
  for (let i = 0; i < strings.length; i++) {
    source += strings[i];
    if (i < strings.length - 1) source += templateMarkers.marker(i);
  }
  const groups = new Map<number, NothingAttributeGroup>();
  const tagPattern = /<(?![!/])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagPattern.exec(source))) {
    const attributePattern = /\s+([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(tag[0]))) {
      const raw = attribute[0];
      const markers = [...raw.matchAll(templateMarkers.pattern)];
      if (markers.length === 0) continue;
      const indices = markers.map((match) => Number(match[1]));
      if (!indices.some((index) => values[index] === nothing)) continue;
      const firstMarker = markers[0];
      const lastMarker = markers[markers.length - 1];
      groups.set(indices[0], {
        first: indices[0],
        last: indices[indices.length - 1],
        prefix: raw.slice(0, firstMarker.index),
        suffix: raw.slice(lastMarker.index! + lastMarker[0].length),
      });
    }
  }
  return groups;
};

class SSRScanner {
  private result: string = '';
  private stringIdx = 0;
  private charIdxForNext = 0;
  private isNodePositions: boolean[];
  private strings: readonly string[];
  private nothingAttributeGroups: Map<number, NothingAttributeGroup>;

  constructor(private resultObj: TemplateResult, private opts: { hydrate?: boolean } = {}) {
    this.strings = scopeTemplateStrings(resultObj.strings, resultObj.__cossackScope);
    this.isNodePositions = classifyPositions(this.strings);
    this.nothingAttributeGroups = findNothingAttributeGroups(this.strings, resultObj.values);
  }

  scan(): string {
    const { values } = this.resultObj;
    const strings = this.strings;

    while (this.stringIdx < strings.length) {
      const str = strings[this.stringIdx];
      const remaining = str.substring(this.charIdxForNext || 0);

      const attrMatch = remaining.match(/(\.\.\.|[.@?]?[a-zA-Z0-9_:-]+)=["']?$/);

      this.result += remaining;
      this.charIdxForNext = 0;

      if (this.stringIdx < strings.length - 1) {
        const val = values[this.stringIdx];
        const nothingGroup = this.nothingAttributeGroups.get(this.stringIdx);
        if (nothingGroup) {
          if (this.result.endsWith(nothingGroup.prefix)) {
            this.result = this.result.slice(0, -nothingGroup.prefix.length);
          }
          this.stringIdx = nothingGroup.last;
          this.charIdxForNext = nothingGroup.suffix.length;
          this.stringIdx++;
          continue;
        }
        if (attrMatch && !this.isNodePositions[this.stringIdx]) {
          const fullMatch = attrMatch[0];
          const name = attrMatch[1];

          this.result = this.result.substring(0, this.result.length - fullMatch.length);

          // Check if we opened a quote
          const quote = fullMatch.endsWith('"') ? '"' : fullMatch.endsWith("'") ? "'" : '';

          let replaced = true;

          if (name === '...') {
            this.result = this.result.trimEnd();
            // renderSpread mutates the context's `result` in place: normal
            // spread attributes are appended, while a caller-supplied `class`
            // is merged into an existing `class="..."` on the current open tag.
            const ctx: SpreadRenderContext = { result: this.result };
            renderSpread(val, ctx);
            this.result = ctx.result;
          } else if (name === 'ref') {
            // `ref` is a Cossack directive (value is a RefObject); it has no
            // meaningful HTML representation, so emit nothing. Leaving a bare
            // `ref=` in the output produces malformed HTML that misparses the
            // following attributes, which hydration (which keeps the SSR DOM)
            // cannot recover from.
            this.result = this.result.trimEnd();
          } else if (name.startsWith('@')) {
            this.result = this.result.trimEnd();
          } else if (name.startsWith('?')) {
            if (val) {
              this.result = this.result.trimEnd();
              this.result += ` ${name.slice(1)}`;
            } else {
              this.result = this.result.trimEnd();
            }
          } else if (name.startsWith('.')) {
            // Unwrap a `bind()` two-way value to the current field value so it
            // follows the same emit rules as a plain property binding.
            let propVal: unknown;
            const isBind = val instanceof BindResult;
            if (isBind) {
              propVal = resolveField(val.component, val.fieldName);
            } else {
              propVal = val;
            }
            const attrName = name.slice(1);
            // For `bind()` on a known boolean attribute (.checked/.disabled),
            // emit a bare attribute when truthy — matching how a checkbox
            // serializes. Plain (non-bind) property bindings keep their
            // original behavior (value="...") to avoid changing existing usage.
            const isBooleanAttr = isBind && BOOLEAN_ATTRS.has(attrName);
            if (isBooleanAttr) {
              this.result = this.result.trimEnd();
              if (propVal) this.result += ` ${attrName}`;
            } else if (propVal !== null && propVal !== undefined && propVal !== false) {
              this.result = this.result.trimEnd();
              this.result += ` ${attrName}="${valueToString(propVal, this.opts)}"`;
            } else {
              this.result = this.result.trimEnd();
            }
          } else if (val instanceof IfDefinedResult) {
            // `ifDefined`: drop the attribute only when the value is undefined;
            // render every other value (incl. false/null/0/'') as a normal
            // attribute string. The value is stringified explicitly so `false`
            // becomes "false" rather than being omitted (which `valueToString`
            // would do for false/null).
            if (val.value === undefined) {
              this.result = this.result.trimEnd();
            } else {
              this.result = this.result.trimEnd();
              this.result += ` ${name}="${escapeHtml(String(val.value))}"`;
            }
          } else if (val === null || val === undefined || val === nothing) {
            this.result = this.result.trimEnd();
          } else if (typeof val === 'boolean') {
            this.result = this.result.trimEnd();
            const serialized = serializeBooleanAttribute(name, val);
            if (serialized === '') this.result += ` ${name}`;
            else if (serialized !== null) this.result += ` ${name}="${serialized}"`;
          } else {
            // Default attribute binding: `name=${val}` or `name="${val}"`.
            // If the template opened a quote (`name="${val}"`), the value goes
            // inside it and the closing quote is the next string's first char,
            // rendered naturally (so `replaced = false` skips the consume
            // below, which would otherwise drop that closing quote). If the
            // template did NOT quote (`class=${classes}`), we MUST add quotes
            // around the value — emitting `class=foo bar baz` would make `bar`
            // and `baz` stray attributes (malformed HTML that breaks hydration).
            this.result += fullMatch;
            const strVal = valueToString(val, this.opts);
            if (quote) {
              this.result += strVal;
              replaced = false; // leave the closing quote in the next string
            } else {
              // strVal is already HTML-escaped by valueToString — don't double-escape.
              this.result += `"${strVal}"`;
            }
          }

          // Consume closing quote if we replaced the attribute logic (suppressed or rewrote)
          if (quote && replaced) {
            const nextStr = strings[this.stringIdx + 1];
            if (nextStr && nextStr.startsWith(quote)) {
              this.charIdxForNext = 1;
            }
          }
        } else if (this.opts.hydrate && this.isNodePositions[this.stringIdx]) {
          // True node (child) position: wrap the rendered value in the SAME
          // marker comments the client renderer uses (`<!--CRP_i-->` start,
          // `<!--/CRP-->` end) so the client can bind NodeParts directly to
          // the existing DOM instead of wiping it. Attribute-interior
          // positions (open quote, no `name=` suffix) are NOT marked — they
          // stay clean, matching the client's classification. Comments are
          // invisible to users and ignored by search engines.
          this.result += `<!--CRP_${this.stringIdx}-->`;
          this.result += valueToString(val, this.opts);
          this.result += `<!--/CRP-->`;
        } else {
          // Default node position, or a value mid-attribute (open quote):
          // concatenate the rendered value. Output is identical with or
          // without `hydrate` here.
          this.result += valueToString(val, this.opts);
        }
      }
      this.stringIdx++;
    }
    return this.result;
  }
}

export const renderToString = (result: TemplateResult, opts: { hydrate?: boolean } = {}): string => {
  const scanner = new SSRScanner(result, opts);
  return scanner.scan();
};

// --- Client-Side Implementation ---

interface Part {
  update(value: unknown): void;
}

const templateIdentities = new WeakMap<TemplateStringsArray, Map<string, object>>();
const templateIdentity = (result: TemplateResult): object => {
  let byType = templateIdentities.get(result.strings);
  if (!byType) {
    byType = new Map();
    templateIdentities.set(result.strings, byType);
  }
  const key = `${result['_$litType$']}:${result.__cossackScope ?? ''}`;
  let identity = byType.get(key);
  if (!identity) {
    identity = {};
    byType.set(key, identity);
  }
  return identity;
};

class NodePart implements Part {
  private componentInstance: CossackElement | null = null;
  private renderListener: ((t: TemplateResult | unknown | null) => void) | null = null;
  private _childParts: NodePart[] = [];
  private _partKeys: unknown[] = [];
  // Cache for nested template result updates
  private _cachedTemplateIdentity: object | null = null;
  private _cachedParts: Part[] | null = null;
  // Tracked key for the `key()` directive
  private _key: unknown = undefined;
  private _keySet = false;
  // Memoization state for the `guard()` directive: the last deps compared and
  // the value the factory produced. `factory` only runs again when deps change.
  private _guardDeps: unknown[] | null = null;
  private _guardHasDeps = false;
  private _guardValue: unknown = undefined;
  // Caching state for the `cache()` directive. Each entry is keyed by the
  // template's `strings` and holds the detached DOM nodes (including anchor
  // comments) plus the Part tree bound to them. When a previously-rendered
  // template is shown again, those nodes are moved back in place and their
  // parts re-applied, preserving component state and DOM identity.
  private _cacheMap = new Map<object, { nodes: Node[]; parts: Part[] }>();
  // The template strings currently displayed (so we know which entry to
  // detach when switching). Null when the current value is not a template.
  private _cacheCurrent: object | null = null;
  // When true, the next update() adopts the existing DOM (produced by SSR)
  // instead of clearing and rebuilding. Set via _beginHydration() so external
  // hydration setup (rebindParts, _adoptSequence) doesn't reach into private
  // state directly.
  private _hydrating = false;

  constructor(
    public startNode: Comment,
    public endNode: Comment,
  ) {}

  /**
   * Mark this part so its next `update()` adopts the existing DOM in place
   * (hydration) instead of clearing and rebuilding. Used by the hydration
   * setup paths after anchors have been rebound to existing nodes.
   * @internal
   */
  _beginHydration(): void {
    this._hydrating = true;
  }

  update(value: unknown) {
    if (this._hydrating) {
      this._hydrating = false;
      this._hydrateValue(value);
      return;
    }
    // `guard`: resolve to its (possibly cached) inner value before any other
    // dispatch. The factory only runs when the deps change; otherwise the
    // previously-produced value is reused, which keeps template part caches
    // intact (in-place update) instead of recomputing.
    if (value instanceof GuardResult) {
      value = this._resolveGuard(value);
    }
    // `cache`: keep previously-rendered template subtrees alive across swaps so
    // toggling back to a cached template reattaches its DOM/parts rather than
    // rebuilding. Non-template values are unwrapped and handled normally.
    let fromCache = false;
    if (value instanceof CacheResult) {
      const inner = value.value;
      if (isTemplateResult(inner)) {
        // The cache fast-path returns early, which would otherwise skip the
        // component/child-part teardown below. Tear down any prior render
        // state held by this part (a previously-rendered component, repeat, or
        // array) so switching INTO cache() does not leak it.
        if (this.componentInstance) this.disposeComponent();
        if (this._childParts.length > 0) this.clearChildParts();
        this.updateCache(inner);
        return;
      }
      value = inner;
      fromCache = true;
    } else if (this._cacheMap.size > 0 || this._cacheCurrent) {
      // Switching AWAY from cache() to an entirely non-cache value: the
      // stashed subtrees are no longer reachable, so dispose their parts
      // (components/listeners/etc.) instead of retaining them until dispose().
      for (const entry of this._cacheMap.values()) {
        for (const part of entry.parts) {
          if (part && typeof (part as any).dispose === 'function') (part as any).dispose();
        }
      }
      this._cacheMap.clear();
      this._cacheCurrent = null;
    }
    // Switching from a cached template to a non-template value: detach & stash
    // the current subtree so it can be restored later, then clear bookkeeping.
    if (fromCache && this._cacheCurrent) {
      this._stashCurrent();
      this._cacheCurrent = null;
    }
    if (this.componentInstance && (!isComponentResult(value) || value.clazz !== this.componentInstance.constructor)) {
      this.disposeComponent();
    }
    if (!(value instanceof RepeatResult) && !Array.isArray(value) && this._childParts.length > 0) {
      this.clearChildParts();
    }
    if (isComponentResult(value)) {
      this.updateComponent(value);
    } else if (value instanceof RepeatResult) {
      this.updateRepeat(value);
    } else if (value instanceof KeyResult) {
      this.updateKey(value);
    } else if (Array.isArray(value)) {
      this.updateArray(value);
    } else {
      this.updateNode(value);
    }
  }

  /**
   * Resolve a `guard()` directive to the value it should render this turn.
   * Shallow-compares the new deps to the previous render's deps: if they are
   * equal, reuse the cached value (factory is NOT called again); otherwise call
   * the factory, cache its result, and return it. A single dep value is wrapped
   * into a one-element array so both call shapes compare the same way.
   */
  private _resolveGuard(result: GuardResult): unknown {
    // Snapshot array deps (shallow clone) so in-place mutations between
    // renders are detected. Without this, a caller that mutates the same
    // deps array would leave _guardDeps and newDeps aliasing the same array,
    // and _depsEqual would always see them as equal — skipping the factory
    // when it should re-run.
    const newDeps = Array.isArray(result.deps) ? [...result.deps] : [result.deps];
    if (this._guardHasDeps && this._depsEqual(this._guardDeps, newDeps)) {
      return this._guardValue;
    }
    this._guardDeps = newDeps;
    this._guardHasDeps = true;
    this._guardValue = result.factory();
    return this._guardValue;
  }

  /**
   * Shallow array equality for `guard()` deps. Same length and every element
   * `===`. Used to decide whether to skip the factory.
   */
  private _depsEqual(a: unknown[] | null, b: unknown[]): boolean {
    if (a === null || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Adoption path: the nodes between startNode/endNode were rendered by SSR
   * from `value`. Bind part state to the existing DOM instead of clearing.
   * Every branch here preserves the SSR nodes when possible; structural
   * mismatches bubble up as a HydrateMismatch (caught by hydrate(), which
   * falls back to a full render).
   */
  private _hydrateValue(value: unknown) {
    if (isComponentResult(value)) {
      this._adoptComponent(value);
      return;
    }
    if (isTemplateResult(value)) {
      this._adoptTemplate(value);
      return;
    }
    if (value instanceof RepeatResult) {
      this._adoptSequence(
        value.items.map((item, i) => value.templateFn(item, i)),
        value.items.map((item, i) => value.keyFn(item, i)),
      );
      return;
    }
    if (Array.isArray(value)) {
      this._adoptSequence(value);
      return;
    }
    if (value instanceof KeyResult) {
      // key() forces a remount when the key changes; on initial hydration the
      // SSR DOM already reflects the template, so adopt it and remember the
      // key. Non-template payloads (rare) fall through to the normal rebuild.
      if (isTemplateResult(value.template)) {
        this._keySet = true;
        this._key = value.value;
        this._adoptTemplate(value.template);
        return;
      }
      this.clear();
      this._clearTemplateCache();
      this.updateNode(value.template);
      return;
    }
    if (value instanceof GuardResult) {
      // On hydration the SSR DOM reflects the factory's output, so evaluate the
      // factory once (priming the memo cache), then adopt whatever it produced.
      const resolved = this._resolveGuard(value);
      this._hydrateValue(resolved);
      return;
    }
    if (value instanceof CacheResult) {
      // On hydration the SSR DOM reflects the inner value; adopt it and prime
      // the cache bookkeeping so a subsequent swap to another template works.
      const inner = value.value;
      if (isTemplateResult(inner)) {
        const identity = templateIdentity(inner);
        if (!this._cacheMap.has(identity)) {
          this._adoptTemplate(inner);
          this._cacheCurrent = identity;
        } else {
          this.updateCache(inner);
        }
      } else {
        this._hydrateValue(inner);
      }
      return;
    }
    if (value === nothing || value === '' || value === null || value === undefined || value === false) {
      // Expected empty; remove any stray SSR nodes.
      this.clear();
      return;
    }
    if (value instanceof Node) {
      // SSR rendered this node; keep it as-is.
      return;
    }
    if (isUnsafeHTML(value)) {
      // The existing DOM already holds the parsed HTML from SSR (the same
      // string the client has). Keep it; a future update with a different
      // value rebuilds via updateNode. If the part is unexpectedly empty,
      // fall through to a rebuild.
      if (this.startNode.nextSibling !== this.endNode) return;
      this.clear();
      this._clearTemplateCache();
      this.updateNode(value);
      return;
    }
    if (typeof value !== 'object') {
      const text = String(value);
      const node = this.startNode.nextSibling;
      if (node && node.nodeType === Node.TEXT_NODE && node.nextSibling === this.endNode) {
        if (node.nodeValue !== text) node.nodeValue = text;
      } else {
        this.clear();
        this.startNode.parentNode!.insertBefore(document.createTextNode(text), this.endNode);
      }
      return;
    }
    // Plain object (spread result, etc.): safe rebuild fallback.
    this.clear();
    this._clearTemplateCache();
    this.updateNode(value);
  }

  /**
   * Adopt a component's SSR-rendered output: create the instance (preserving
   * state/reactivity) and bind its render listener to HYDRATE the existing
   * DOM on its first render instead of clearing and rebuilding. Subsequent
   * renders reconcile via the normal updateNode cache path.
   */
  private _adoptComponent(result: ComponentResult) {
    const desiredParent = result.parent || CossackElement.currentRenderingInstance;
    if (
      this.componentInstance
      && (
        this.componentInstance.constructor !== result.clazz
        || this.componentInstance.__parent !== desiredParent
      )
    ) {
      this.disposeComponent();
    }
    if (!this.componentInstance) {
      this.componentInstance = new result.clazz();
      this.componentInstance.__parent = desiredParent;
      if (result.serviceScope && typeof (this.componentInstance as any)._setServiceScope === 'function') {
        (this.componentInstance as any)._setServiceScope(result.serviceScope);
      }
      if (this.componentInstance.__parent) {
        this.componentInstance._id = `${this.componentInstance.__parent._id}:${(this.componentInstance.__parent as any)._childCounter++}`;
      }
      let firstRender = true;
      this.renderListener = (template) => {
        if (firstRender) {
          firstRender = false;
          if (isTemplateResult(template)) {
            // Best-effort: adopt the component's SSR-rendered output. This
            // succeeds when the server and client render the same structure
            // (the common case, and always in production). It can diverge in
            // dev (where the client wraps render() in devtools marker
            // comments that SSR doesn't emit) or with non-deterministic
            // render — on any mismatch, fall back to a clean rebuild so the
            // component always ends up correct.
            try {
              this._adoptTemplate(template);
            } catch (e) {
              if (e instanceof HydrateMismatch) {
                this.clear();
                this._clearTemplateCache();
                this.updateNode(template);
              } else {
                throw e;
              }
            }
          } else if (template === null || template === undefined) {
            this.clear();
          } else {
            this.updateNode(template);
          }
        } else {
          this.updateNode(template);
        }
      };
      this.componentInstance.addRenderListener(this.renderListener);
      Object.assign(this.componentInstance, result.props);
      if ('props' in this.componentInstance) {
        (this.componentInstance as any).props = result.props;
      }
      this.componentInstance.children = result.children;
      this.componentInstance.connectedCallback();
    }
    const instance = this.componentInstance;
    Object.assign(instance, result.props);
    if ('props' in instance) {
      (instance as any).props = result.props;
    }
    instance.children = result.children;
    instance.requestUpdate();
  }

  /**
   * Adopt a list (array or repeat) whose SSR output is wrapped in CSA item
   * markers. Splits the existing nodes into per-item NodeParts (anchored on
   * the CSA comments) and hydrates each item. Falls back to rebuild if the
   * CSA structure doesn't match the item count.
   */
  private _adoptSequence(items: unknown[], keys?: unknown[]) {
    const nodes = this._nodesBetween();
    const pairs = findSequencePairs(nodes);
    // If the SSR item count doesn't match, we can't safely adopt — rebuild.
    if (pairs.length !== items.length) {
      throw new HydrateMismatch(
        `sequence length mismatch: SSR has ${pairs.length} items, client has ${items.length}`,
      );
    }
    this._childParts = [];
    this._partKeys = keys ? [] : this._partKeys;
    for (let i = 0; i < items.length; i++) {
      const [start, end] = pairs[i];
      const part = new NodePart(start, end);
      part._beginHydration();
      this._childParts.push(part);
      if (keys) this._partKeys.push(keys[i]);
      part.update(items[i]);
    }
  }

  /**
   * Hydrate a nested TemplateResult against the SSR DOM that already sits
   * between this part's anchors. Populates `_cachedParts` so subsequent
   * updates reconcile in place via the normal `updateNode` cache path.
   */
  private _adoptTemplate(value: TemplateResult) {
    const { fragment: blueprint, parts } = compileTemplate(value);
    const existing = this._nodesBetween();
    const map = new Map<Node, Node>();
    reconcileNodeLists(blueprint.childNodes, existing, map);
    rebindParts(parts, map);
    for (let i = 0; i < value.values.length; i++) {
      if (parts[i]) parts[i]!.update(value.values[i]);
    }
    this._cachedTemplateIdentity = templateIdentity(value);
    this._cachedParts = parts;
  }

  private _nodesBetween(): Node[] {
    const out: Node[] = [];
    let n: Node | null = this.startNode.nextSibling;
    while (n && n !== this.endNode) {
      out.push(n);
      n = n.nextSibling;
    }
    return out;
  }

  private teardownComponent(instance: any) {
    if (this.renderListener) {
      instance.removeRenderListener(this.renderListener);
      this.renderListener = null;
    }
    instance.disconnectedCallback();
    // Full Cossack-level cleanup (WebSockets, IntersectionObservers, event
    // listeners). Without this, child components removed via repeat/key/
    // conditional rendering leak live connections for the page's lifetime.
    if (typeof instance.destroy === 'function') {
      try {
        instance.destroy();
      } catch {
        // Component may already be destroyed (phase guard); ignore.
      }
    }
  }

  private disposeComponent() {
    if (this.componentInstance) {
      this.teardownComponent(this.componentInstance);
      this.componentInstance = null;
      this._clearTemplateCache();
    }
  }

  private updateComponent(result: ComponentResult) {
    const desiredParent = result.parent || CossackElement.currentRenderingInstance;
    if (this.componentInstance && this.componentInstance.__parent !== desiredParent) {
      this.disposeComponent();
    }
    if (!this.componentInstance) {
      this.componentInstance = new result.clazz();
      this.componentInstance.__parent = desiredParent;
      if (result.serviceScope && typeof (this.componentInstance as any)._setServiceScope === 'function') {
        (this.componentInstance as any)._setServiceScope(result.serviceScope);
      }
      if (this.componentInstance.__parent) {
        this.componentInstance._id = `${this.componentInstance.__parent._id}:${this.componentInstance.__parent._childCounter++}`;
      }
      this.renderListener = (template) => {
        this.updateNode(template);
      };
      this.componentInstance.addRenderListener(this.renderListener);
      Object.assign(this.componentInstance, result.props);
      if ('props' in this.componentInstance) {
        (this.componentInstance as any).props = result.props;
      }
      this.componentInstance.children = result.children;
      this.componentInstance.connectedCallback();
    }
    const instance = this.componentInstance;
    Object.assign(instance, result.props);
    if ('props' in instance) {
      (instance as any).props = result.props;
    }
    instance.children = result.children;
    instance.requestUpdate();
  }

  private updateRepeat(result: RepeatResult) {
    const { items, keyFn, templateFn } = result;
    const oldPartsMap = new Map<unknown, NodePart>();
    this._childParts.forEach((part, i) => {
      const key = this._partKeys[i];
      if (key !== undefined) oldPartsMap.set(key, part);
    });
    const newParts: NodePart[] = [];
    const newKeys: unknown[] = [];
    let insertAfterNode: Node = this.startNode;
    items.forEach((item, index) => {
      const key = keyFn(item, index);
      newKeys.push(key);
      let part = oldPartsMap.get(key);
      if (part) {
        oldPartsMap.delete(key);
        if (part.startNode.previousSibling !== insertAfterNode) {
          this.movePart(part, insertAfterNode);
        }
        part.update(templateFn(item, index));
      } else {
        part = this.createChildPart(insertAfterNode);
        part.update(templateFn(item, index));
      }
      newParts.push(part);
      insertAfterNode = part.endNode;
    });
    oldPartsMap.forEach((part) => part.dispose());
    this._childParts = newParts;
    this._partKeys = newKeys;
  }

  private updateKey(result: KeyResult) {
    const changed = !this._keySet || !Object.is(this._key, result.value);
    this._keySet = true;
    this._key = result.value;
    if (changed) {
      // Key changed (or first render): tear down & rebuild so the subtree
      // (and any CSS animations / child components) re-runs from scratch.
      if (this.componentInstance) {
        this.disposeComponent();
      }
      this._clearTemplateCache();
      this.clear();
    }
    this.updateNode(result.template);
  }

  /**
   * `cache()` render path. Keeps previously-rendered template subtrees (their
   * DOM nodes AND Part tree) alive across template swaps so toggling back
   * restores the same nodes/state instead of rebuilding.
   *
   *   - Same template as last render → in-place part update (the common,
   *     unchanged case; identical to a plain `updateNode` cache hit).
   *   - Switching away from a different template → detach that template's nodes
   *     into a stashed entry (keeps its parts alive, bound to those nodes).
   *   - Switching to a previously-stashed template → move its nodes back in and
   *     apply the new values to its parts. DOM identity preserved.
   *   - Switching to a never-seen template → build fresh (degrades to a normal
   *     render) and record it as the current entry.
   */
  private updateCache(result: TemplateResult) {
    const identity = templateIdentity(result);
    if (this._cacheCurrent === identity && this._cachedParts) {
      // Same template → update parts in place.
      this._cachedParts.forEach((part, i) => {
        part.update(result.values[i]);
      });
      return;
    }

    // Switching templates: stash whatever subtree is currently shown so it can
    // be restored later. This covers both a cached template and a plain (non
    // cache-routed) render that a previous value left here.
    if (this._cacheCurrent || this._cachedParts) {
      this._stashCurrent();
    }

    const entry = this._cacheMap.get(identity);
    if (entry) {
      // Restore a previously-cached subtree: move its nodes back into the DOM
      // (between this part's anchors) and re-apply values to its parts.
      this.clear();
      const parent = this.startNode.parentNode;
      if (!parent) return;
      for (const node of entry.nodes) {
        parent.insertBefore(node, this.endNode);
      }
      this._cachedTemplateIdentity = identity;
      this._cachedParts = entry.parts;
      for (let i = 0; i < result.values.length; i++) {
        if (entry.parts[i]) entry.parts[i]!.update(result.values[i]);
      }
    } else {
      // Never-seen template: build fresh. `_stashCurrent` (above) already
      // detached the previous subtree and cleared the active template cache
      // (_cachedParts/Strings); we must NOT call _clearTemplateCache() here
      // because that would also wipe the just-stashed `cache()` entries.
      this.clear();
      this.updateNode(result);
    }
    this._cacheCurrent = identity;
  }

  /**
   * Stash the currently-displayed subtree (nodes + parts) into the cache map
   * keyed by its template strings, so it can be restored on a later render.
   * The nodes are detached from the DOM but kept alive (with their parts still
   * bound to them). Does nothing if there is no current template cache entry.
   */
  private _stashCurrent() {
    if (!this._cachedParts) return;
    const identity = this._cacheCurrent ?? this._cachedTemplateIdentity;
    if (!identity) {
      // No template strings to key on (e.g. plain value); just drop the cache.
      this._clearTemplateCache();
      this.clear();
      return;
    }
    const nodes = this._nodesBetween();
    // Detach the nodes into a DocumentFragment so they leave the live DOM but
    // stay together; keep the captured node references for reinsertion.
    const frag = document.createDocumentFragment();
    for (const node of nodes) frag.appendChild(node);
    this._cacheMap.set(identity, { nodes, parts: this._cachedParts });
    // Drop the active-cache bookkeeping so the next render starts clean. Do NOT
    // dispose the cached parts — they belong to the stashed entry now.
    this._cachedTemplateIdentity = null;
    this._cachedParts = null;
  }

  private updateArray(values: unknown[]) {
    this._partKeys = [];
    const minLength = Math.min(values.length, this._childParts.length);
    for (let i = 0; i < minLength; i++) {
      this._childParts[i].update(values[i]);
    }
    if (values.length > this._childParts.length) {
      let lastNode =
        this._childParts.length > 0 ? this._childParts[this._childParts.length - 1].endNode : this.startNode;
      for (let i = minLength; i < values.length; i++) {
        const part = this.createChildPart(lastNode);
        this._childParts.push(part);
        part.update(values[i]);
        lastNode = part.endNode;
      }
    }
    if (values.length < this._childParts.length) {
      for (let i = this._childParts.length - 1; i >= values.length; i--) {
        const part = this._childParts[i];
        part.dispose();
        this._childParts.pop();
      }
    }
  }

  private createChildPart(insertAfter: Node): NodePart {
    const start = document.createComment('CRP-Item');
    const end = document.createComment('/CRP-Item');
    const next = insertAfter.nextSibling;
    insertAfter.parentNode!.insertBefore(start, next);
    insertAfter.parentNode!.insertBefore(end, next);
    return new NodePart(start, end);
  }

  private movePart(part: NodePart, insertAfter: Node) {
    const parent = insertAfter.parentNode!;
    const nodes: Node[] = [];
    let current: Node | null = part.startNode;
    while (current && current !== part.endNode) {
      nodes.push(current);
      current = current.nextSibling;
    }
    nodes.push(part.endNode);
    const ref = insertAfter.nextSibling;
    nodes.forEach((node) => parent.insertBefore(node, ref));
  }

  private clearChildParts() {
    this._childParts.forEach((part) => part.dispose());
    this._childParts = [];
    this._partKeys = [];
  }

  dispose() {
    this.clear();
    this._clearTemplateCache();
    // Tear down the `cache()` stash: its parts hold detached subtrees (and any
    // components within them) that are no longer reachable once this part is
    // disposed.
    if (this._cacheMap.size > 0) {
      for (const entry of this._cacheMap.values()) {
        for (const part of entry.parts) {
          if (part && typeof (part as any).dispose === 'function') (part as any).dispose();
        }
      }
      this._cacheMap.clear();
    }
    this._cacheCurrent = null;
    this.clearChildParts();
    if (this.startNode.parentNode) this.startNode.parentNode.removeChild(this.startNode);
    if (this.endNode.parentNode) this.endNode.parentNode.removeChild(this.endNode);
    if (this.componentInstance) {
      this.teardownComponent(this.componentInstance);
      this.componentInstance = null;
    }
  }

  private updateNode(value: unknown) {
    if (!this.startNode.parentNode) return;
    if (isTemplateResult(value)) {
      // Check if we have a cached template with the same strings
      if (this._cachedTemplateIdentity === templateIdentity(value) && this._cachedParts) {
        // Template structure is the same, just update the parts
        this._cachedParts.forEach((part, i) => {
          part.update(value.values[i]);
        });
      } else {
        // Template structure changed, clear and re-render
        this._clearTemplateCache();
        this.clear();
        const container = document.createDocumentFragment();
        render(value, container);
        this.startNode.parentNode!.insertBefore(container, this.endNode);
        // Cache the template strings and parts for future updates
        const cached = containerCache.get(container.firstChild?.childNodes[0] || container);
        if (cached) {
          this._cachedTemplateIdentity = cached.identity;
          this._cachedParts = cached.parts;
        }
      }
    } else if (isUnsafeHTML(value)) {
      this._clearTemplateCache();
      this.clear();
      const temp = document.createElement('template');
      temp.innerHTML = value.value;
      this.startNode.parentNode!.insertBefore(temp.content, this.endNode);
    } else if (
      isComponentResult(value) ||
      (typeof value === 'object' && value !== null && !(value instanceof Node) && !Array.isArray(value))
    ) {
      // Handle ComponentResult or other objects by wrapping in template
      this._clearTemplateCache();
      this.clear();
      const container = document.createDocumentFragment();
      render(html`${value}`, container);
      this.startNode.parentNode!.insertBefore(container, this.endNode);
    } else if (value instanceof Node) {
      this._clearTemplateCache();
      this.clear();
      this.startNode.parentNode!.insertBefore(value, this.endNode);
    } else if (value === nothing || value === '' || value === null || value === undefined || value === false) {
      this._clearTemplateCache();
      this.clear();
    } else {
      const text = String(value);
      const node = this.startNode.nextSibling;
      if (node && node.nodeType === Node.TEXT_NODE && node.nextSibling === this.endNode) {
        if (node.nodeValue !== text) node.nodeValue = text;
      } else {
        this._clearTemplateCache();
        this.clear();
        const textNode = document.createTextNode(text);
        this.startNode.parentNode!.insertBefore(textNode, this.endNode);
      }
    }
  }

  private _clearTemplateCache() {
    // Dispose cached sub-parts before dropping them. Cached parts may hold live
    // component instances (rendered via nested templates); without disposing
    // them, re-rendering a part with a different value leaks those components'
    // WebSockets / observers / listeners for the page's lifetime.
    if (this._cachedParts) {
      for (const part of this._cachedParts) {
        if (part && typeof (part as any).dispose === 'function') (part as any).dispose();
      }
    }
    this._cachedTemplateIdentity = null;
    this._cachedParts = null;
    // NOTE: the `cache()` stash map (`_cacheMap`) is intentionally NOT cleared
    // here — `_clearTemplateCache` is invoked by `updateNode` on every template
    // switch (including the fresh-build path inside `updateCache` itself), so
    // clearing it here would wipe entries that were just stashed. The stash is
    // torn down explicitly in `dispose()` and when the part switches away from
    // the cache directive entirely.
  }

  clear() {
    let node = this.startNode.nextSibling;
    while (node && node !== this.endNode) {
      const next = node.nextSibling;
      node.parentNode!.removeChild(node);
      node = next;
    }
  }
}

class SpreadPart implements Part {
  private previousValues: Record<string, unknown> = {};
  // Per-key state for `bind()` directives routed through the spread (e.g.
  // component(Input, { '.value': bind(this, 'name') })). Mirrors the per-part
  // fields AttributePart uses for the direct .value="${bind(...)}" path.
  private bindStates = new Map<string, {
    listener: EventListener;
    lastKind: 'value' | 'checked' | null;
    lastValue: unknown;
    boundComponent: unknown;
    boundField: string;
  }>();
  // Tracks the class tokens this spread has added to the element, so updates
  // remove only those (not the component's own classes) and merge with the
  // existing class list instead of overwriting it.
  private spreadClasses: string[] = [];
  constructor(public element: Element) {}
  update(value: unknown) {
    if (value !== nothing && (typeof value !== 'object' || value === null)) return;
    const props = value === nothing ? {} : value as Record<string, unknown>;

    for (const key of Object.keys(this.previousValues)) {
      if (!(key in props)) {
        if (key.startsWith('@')) {
          const eventName = key.slice(1);
          const propName = `__crp_handler_${eventName}`;
          const oldHandler = (this.element as any)[propName];
          if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
        } else if (key.startsWith('.')) {
          // Detach a previously-bound writeback listener when the key is dropped.
          const state = this.bindStates.get(key);
          if (state) {
            this.element.removeEventListener((state.listener as any).__eventName, state.listener);
            this.bindStates.delete(key);
          }
          (this.element as any)[key.slice(1)] = undefined;
        } else if (key.startsWith('?')) {
          this.element.removeAttribute(key.slice(1));
        } else if (key === 'class' || key === 'className') {
          // Remove only the class tokens this spread previously added, leaving
          // the component's own classes intact.
          for (const cls of this.spreadClasses) {
            this.element.classList.remove(cls);
          }
          this.spreadClasses = [];
        } else {
          this.element.removeAttribute(key);
        }
      }
    }

    for (const [key, val] of Object.entries(props)) {
      if (key.startsWith('@')) {
        const eventName = key.slice(1);
        const propName = `__crp_handler_${eventName}`;
        const oldHandler = (this.element as any)[propName];
        if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
        if (val === nothing || (typeof val !== 'function' && !(val instanceof PreventDefaultResult))) {
          (this.element as any)[propName] = undefined;
          continue;
        }
        // Unwrap `preventDefault(handler)` into a wrapper that prevents the
        // event default first and applies `novalidate` to the bound <form>.
        let handler: EventListener;
        if (val instanceof PreventDefaultResult) {
          const inner = val.handler;
          const formEl = this.element instanceof HTMLFormElement
            ? this.element
            : (this.element as Element).closest('form');
          if (formEl instanceof HTMLFormElement) {
            if (val.novalidate) {
              formEl.setAttribute('novalidate', '');
            } else {
              formEl.removeAttribute('novalidate');
            }
          }
          handler = (e: Event) => {
            e.preventDefault();
            inner.call(e.currentTarget, e);
          };
        } else {
          handler = val as EventListener;
        }
        (this.element as any)[propName] = handler;
        this.element.addEventListener(eventName, handler);
      } else if (key.startsWith('.')) {
        const propName = key.slice(1);
        const priorBind = this.bindStates.get(key);
        if (priorBind && !(val instanceof BindResult)) {
          this.element.removeEventListener((priorBind.listener as any).__eventName, priorBind.listener);
          this.bindStates.delete(key);
        }
        // bind() via the spread — same two-way handling as the direct path so
        // component(Input, { '.value': bind(this, 'name') }) works. Without
        // this, element.value = BindResult renders "[object Object]".
        if (val === nothing) {
          (this.element as any)[propName] = undefined;
        } else if (val instanceof BindResult && (propName === 'value' || propName === 'checked')) {
          this.applySpreadBind(key, propName, val);
        } else if (val instanceof LiveResult && (propName === 'value' || propName === 'checked')) {
          // live() via the spread: compare against the live DOM value (not the
          // last-rendered value) so an in-progress user edit isn't clobbered,
          // and a divergent DOM value is corrected. Mirrors AttributePart.
          const el = this.element as any;
          if (propName === 'checked') {
            const boolValue = Boolean(val.value);
            if (el.checked !== boolValue) el.checked = boolValue;
          } else {
            const strValue = val.value == null ? '' : String(val.value);
            if (el.value !== strValue) el.value = strValue;
          }
        } else if (val instanceof BindResult) {
          // bind() on a non-form property (.disabled/.data-*) — read-only
          // fallback: push the current field value, no writeback. Mirrors
          // AttributePart.updateBind's unsupported-property branch. Without
          // this, element.disabled = BindResult sets a truthy [object Object].
          (this.element as any)[propName] = resolveField(val.component, val.fieldName);
        } else if (val instanceof LiveResult) {
          (this.element as any)[propName] = val.value;
        } else {
          (this.element as any)[propName] = val;
        }
      } else if (key.startsWith('?')) {
        if (val !== nothing && val) this.element.setAttribute(key.slice(1), '');
        else this.element.removeAttribute(key.slice(1));
      } else if (val === nothing) {
        if (key === 'class' || key === 'className') this.applySpreadClass('');
        else this.element.removeAttribute(key);
      } else if (val instanceof IfDefinedResult) {
        // `ifDefined` via the spread (e.g. component(El, { href: ifDefined(url) })):
        // drop only on undefined; render every other value (incl. false/null) as a
        // literal attribute string, mirroring the AttributePart path. Checked
        // before the `typeof val === 'boolean'` branch so `false` renders as
        // "false".
        if (val.value === undefined) {
          this.element.removeAttribute(key);
        } else {
          this.element.setAttribute(key, String(val.value));
        }
      } else if (val === null || val === undefined) {
        this.element.removeAttribute(key);
      } else if (typeof val === 'boolean') {
        const serialized = serializeBooleanAttribute(key, val);
        if (serialized === null) this.element.removeAttribute(key);
        else this.element.setAttribute(key, serialized);
      } else if ((key === 'class' || key === 'className') && typeof val === 'string') {
        // Merge caller-supplied classes with the element's existing classes
        // (including the component's own) instead of overwriting. Track which
        // tokens we added so a later update removes only those.
        this.applySpreadClass(val);
      } else {
        this.element.setAttribute(key, String(val));
      }
    }
    this.previousValues = { ...props };
  }

  /**
   * Merge caller-supplied classes into the element's existing class list
   * (preserving the component's own classes) instead of overwriting. Tracks
   * the added tokens so a later update or removal only touches those.
   */
  private applySpreadClass(val: string) {
    // Remove the tokens from the previous spread, then add the new ones.
    for (const cls of this.spreadClasses) {
      this.element.classList.remove(cls);
    }
    const tokens = val.split(/\s+/).filter(Boolean);
    for (const cls of tokens) {
      this.element.classList.add(cls);
    }
    this.spreadClasses = tokens;
  }

  /**
   * Two-way bind for a `.value`/`.checked` key routed through the spread.
   * Mirrors AttributePart.updateBind: push the current field value into the
   * DOM (dirty-checked) and attach the writeback listener once.
   */
  private applySpreadBind(key: string, propName: 'value' | 'checked', bind: BindResult) {
    const el = this.element as any;
    const component = bind.component;

    // Render direction: dirty-checked push of the current field value.
    const current = resolveField(component, bind.fieldName);
    let state = this.bindStates.get(key);
    if (propName === 'checked') {
      const boolValue = Boolean(current);
      if (!state || state.lastKind !== 'checked' || state.lastValue !== boolValue) {
        el.checked = boolValue;
      }
    } else {
      const strValue = current == null ? '' : String(current);
      if (
        !state ||
        state.lastKind !== 'value' ||
        String(state.lastValue) !== strValue ||
        (this.element instanceof HTMLSelectElement && el.value !== strValue)
      ) {
        el.value = strValue;
      }
    }

    // Attach/recreate the writeback listener when the target changes.
    const eventName = bindEventFor(this.element, propName);
    const stale = !!state && (
      state.boundComponent !== component ||
      state.boundField !== bind.fieldName ||
      (state.listener as any).__eventName !== eventName
    );
    if (state && stale) {
      this.element.removeEventListener((state.listener as any).__eventName, state.listener);
      this.bindStates.delete(key);
      state = undefined;
    }
    if (!state) {
      const listener = (e: Event) => {
        const source = e.currentTarget as Element & Record<string, any>;
        const next = propName === 'checked' ? !!source[propName] : source[propName];
        if (component) setField(component, bind.fieldName, next);
      };
      (listener as any).__eventName = eventName;
      this.element.addEventListener(eventName, listener);
      state = {
        listener,
        lastKind: propName,
        lastValue: propName === 'checked' ? Boolean(current) : (current == null ? '' : String(current)),
        boundComponent: component,
        boundField: bind.fieldName,
      };
      this.bindStates.set(key, state);

      if (propName === 'value') {
        reapplySelectValueAfterChildren(
          this.element,
          () => this.bindStates.get(key) === state,
          () => resolveField(state!.boundComponent, state!.boundField),
        );
      }
    } else {
      // Update the stored last-comitted value so the next render dirty-checks.
      state.lastKind = propName;
      state.lastValue = propName === 'checked' ? Boolean(current) : (current == null ? '' : String(current));
    }
  }
}

interface MultiMarkerState {
  // Shared between all AttributeParts of the same attribute.
  // One slot per marker, holding the latest value passed to each part.
  currentValues: unknown[];
  // Which slot this part owns.
  position: number;
}

class AttributePart implements Part {
  // N+1 static segments for N markers. For single-marker (N=1),
  // segments is [prefix, suffix].
  private segments: string[];
  private isMulti: boolean;
  private multiState: MultiMarkerState | null;
  // Tracks the last value this part committed (for the `.value`/`.checked`
  // dirty check). Plain bindings skip the write when the new value equals
  // this; `live()` instead compares against the live DOM. Matches Lit's
  // semantics where `live()` switches the comparison source.
  private lastFormValue: unknown = undefined;
  private lastFormKind: 'value' | 'checked' | null = null;
  // Two-way binding (`bind()`) state: the writeback listener is attached once
  // and reuses this stored closure so re-renders don't pile up duplicates. We
  // also track which component/field the closure writes to so a re-render with
  // a different `bind(otherComponent, 'field')` recreates the listener instead
  // of silently writing to the old target.
  private bindListener: ((e: Event) => void) | null = null;
  private boundPropName: string | null = null;
  private boundComponent: unknown = null;
  private boundFieldName: string | null = null;

  private _detachBindListener() {
    if (!this.bindListener) return;
    const prev = this.bindListener as any;
    this.element.removeEventListener(prev.__eventName, prev);
    this.bindListener = null;
    this.boundPropName = null;
    this.boundComponent = null;
    this.boundFieldName = null;
  }

  constructor(
    public element: Element,
    public name: string,
    originalValue: string,
    multiState?: MultiMarkerState,
  ) {
    // Parse all markers into segments (works for N=1 and N>1).
    const matches = [...originalValue.matchAll(/__CRP_(\d+)__/g)];
    this.segments = [];
    let lastEnd = 0;
    for (const m of matches) {
      const start = m.index!;
      this.segments.push(originalValue.substring(lastEnd, start));
      lastEnd = start + m[0].length;
    }
    this.segments.push(originalValue.substring(lastEnd));
    this.isMulti = matches.length > 1;
    this.multiState = multiState ?? null;
  }
  update(value: unknown) {
    if (value === nothing) {
      if (this.bindListener) this._detachBindListener();
      if (this.isMulti && this.multiState) {
        this.multiState.currentValues[this.multiState.position] = nothing;
        this.element.removeAttribute(this.name);
        return;
      }
      if (this.name.startsWith('@')) {
        (this.element as any)[`__crp_handler_${this.name.slice(1)}`] = undefined;
        this.element.removeAttribute(this.name);
      } else if (this.name.startsWith('.')) {
        const propName = this.name.slice(1);
        (this.element as any)[propName] = undefined;
        this.lastFormKind = null;
        this.lastFormValue = undefined;
        this.element.removeAttribute(this.name);
      } else if (this.name.startsWith('?')) {
        this.element.removeAttribute(this.name.slice(1));
        this.element.removeAttribute(this.name);
      } else {
        this.element.removeAttribute(this.name);
      }
      return;
    }
    let isLive = false;
    if (value instanceof LiveResult) {
      isLive = true;
      value = value.value;
    }
    // `ifDefined`: drop the attribute only when the value is undefined; render
    // every other value (including false/null/0/'') as a normal attribute. The
    // unwrap is done up front so the rest of update() sees the plain value and
    // just needs the `isIfDefined` flag to opt out of the default false/null
    // omission in the final setAttribute branch.
    let isIfDefined = false;
    if (value instanceof IfDefinedResult) {
      isIfDefined = true;
      value = value.value;
    }
    if (value instanceof BindResult) {
      this.updateBind(value);
      return;
    }
    // Detach any bind() writeback listener when this part is no longer bound
    // (e.g. template conditionally switched from bind(...) to a plain value).
    if (this.bindListener) {
      this._detachBindListener();
    }
    if (this.name === 'ref') {
      if (typeof value === 'function') {
        // Function ref: call the function with the element
        (value as (...args: any[]) => void)(this.element);
      } else if (value && typeof value === 'object' && 'value' in value) {
        // RefObject: assign the element to ref.value
        (value as { value: unknown }).value = this.element;
      }
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
      return;
    }

    if (this.isMulti && this.multiState) {
      // Multi-marker attribute: store our slot, then re-interpolate the
      // full string using every part's latest value and set once.
      const { currentValues, position } = this.multiState;
      currentValues[position] = value;
      if (currentValues.includes(nothing)) {
        this.element.removeAttribute(this.name);
        return;
      }
      let result = this.segments[0];
      for (let i = 0; i < currentValues.length; i++) {
        result += String(currentValues[i]) + this.segments[i + 1];
      }
      this.element.setAttribute(this.name, result);
      return;
    }

    if (this.name.startsWith('@')) {
      // Stable delegating wrapper: register a single listener on the element
      // that delegates to whatever handler is stored at any given moment.
      // This avoids remove/add churn during dispatch (re-entrancy) and
      // correctly disables when value becomes non-function (null/undefined).
      const eventName = this.name.slice(1);
      const handlerProp = `__crp_handler_${eventName}`;
      const wrapperProp = `__crp_wrapper_${eventName}`;
      if (!(this.element as any)[wrapperProp]) {
        const wrapper = (e: Event) => {
          const current = (e.currentTarget as any)?.[handlerProp];
          if (typeof current === 'function') current.call(e.currentTarget, e);
        };
        (this.element as any)[wrapperProp] = wrapper;
        this.element.addEventListener(eventName, wrapper);
      }
      // Unwrap `preventDefault(handler)` into the inner handler; when present,
      // wrap it so the event's default is prevented first. `novalidate` (on by
      // default for the directive) disables browser-native validation on the
      // bound <form> since Cossack encourages custom `@Validate` validation.
      // Toggling { novalidate } across re-renders sets/removes the attribute so
      // the latest value always wins (a form previously rendered with the
      // default must have native validation restored when switched to false).
      let resolved = value;
      if (resolved instanceof PreventDefaultResult) {
        const inner = resolved.handler;
        const formEl = this.element instanceof HTMLFormElement
          ? this.element
          : (this.element as Element).closest('form');
        if (formEl instanceof HTMLFormElement) {
          if (resolved.novalidate) {
            formEl.setAttribute('novalidate', '');
          } else {
            formEl.removeAttribute('novalidate');
          }
        }
        resolved = (e: Event) => {
          e.preventDefault();
          inner.call(e.currentTarget, e);
        };
      }
      (this.element as any)[handlerProp] = typeof resolved === 'function' ? resolved : undefined;
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
    } else if (this.name.startsWith('.')) {
      const propName = this.name.slice(1);
      // `.value`/`.checked` on form fields get Lit-style dirty-checking so a
      // re-render doesn't clobber an in-progress user edit; `live()` switches
      // the comparison to the live DOM (see `lastFormValue`).
      const isFormProp =
        propName === 'value' || propName === 'checked'
          ? this.element instanceof HTMLInputElement ||
            this.element instanceof HTMLTextAreaElement ||
            this.element instanceof HTMLSelectElement
          : false;
      if (isFormProp) {
        if (propName === 'checked') {
          const boolValue = Boolean(value);
          const shouldWrite = isLive
            ? (this.element as any).checked !== boolValue // compare against live DOM
            : this.lastFormKind !== 'checked' || this.lastFormValue !== boolValue; // dirty check
          if (shouldWrite) {
            (this.element as any).checked = boolValue;
            this.lastFormValue = boolValue;
            this.lastFormKind = 'checked';
          }
        } else {
          const strValue = String(value);
          const shouldWrite = isLive
            ? (this.element as any).value !== strValue // compare against live DOM
            : this.lastFormKind !== 'value' || String(this.lastFormValue) !== strValue; // dirty check
          if (shouldWrite) {
            (this.element as any).value = strValue;
            this.lastFormValue = value;
            this.lastFormKind = 'value';
          }
        }
      } else {
        (this.element as any)[propName] = value;
      }
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
    } else if (this.name.startsWith('?')) {
      const attrName = this.name.slice(1);
      if (value) this.element.setAttribute(attrName, '');
      else this.element.removeAttribute(attrName);
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
    } else if (isIfDefined) {
      // `ifDefined`: drop only on `undefined`; render everything else (incl.
      // false/null/0/'') as a literal attribute string. Must be checked before
      // the `typeof value === 'boolean'` branch so `false` renders as "false".
      if (value === undefined) {
        this.element.removeAttribute(this.name);
      } else {
        this.element.setAttribute(this.name, this.segments[0] + String(value) + this.segments[1]);
      }
    } else if (value === null || value === undefined) {
      this.element.removeAttribute(this.name);
    } else if (typeof value === 'boolean') {
      const serialized = serializeBooleanAttribute(this.name, value);
      if (serialized === null) this.element.removeAttribute(this.name);
      else this.element.setAttribute(this.name, serialized);
    } else {
      this.element.setAttribute(this.name, this.segments[0] + String(value) + this.segments[1]);
    }
  }

  /**
   * Two-way binding (`bind(this, 'field')`). Called when the part's value is a
   * `BindResult`. The DOM property (value/checked) is inferred from the bound
   * attribute name; a writeback listener is attached once and reuses the same
   * closure across re-renders so duplicates never accumulate.
   *
   * The render-direction write uses the same dirty-check as a plain `.value`
   * binding so a re-render with an unchanged field does not clobber a user's
   * in-progress edit — the field typically only changes BECAUSE the user
   * edited the input, so skipping is correct and avoids a feedback loop.
   */
  private updateBind(bind: BindResult) {
    // `.value` / `.checked` only — bind() is a form-element directive.
    const propName = this.name.startsWith('.') ? this.name.slice(1) : this.name;
    if (propName !== 'value' && propName !== 'checked') {
      // Unsupported property: fall back to a plain property assignment so the
      // render still reflects the current field value, with no writeback.
      (this.element as any)[propName] = resolveField(bind.component, bind.fieldName);
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
      // Detach any listener from a previous bind() — switching from .value to
      // .foo on the same part would otherwise leave the old listener attached.
      if (this.bindListener) {
        this._detachBindListener();
      }
      return;
    }

    const el = this.element as any;
    const component = bind.component as any;

    // Render direction: push current field value into the DOM (dirty-checked
    // against the last value we committed, so an unchanged field — e.g. the
    // user is mid-edit and nothing else changed — is left alone).
    const current = resolveField(component, bind.fieldName);
    if (propName === 'checked') {
      const boolValue = Boolean(current);
      if (this.lastFormKind !== 'checked' || this.lastFormValue !== boolValue) {
        el.checked = boolValue;
        this.lastFormValue = boolValue;
        this.lastFormKind = 'checked';
      }
    } else {
      const strValue = current == null ? '' : String(current);
      if (
        this.lastFormKind !== 'value' ||
        String(this.lastFormValue) !== strValue ||
        (this.element instanceof HTMLSelectElement && el.value !== strValue)
      ) {
        el.value = strValue;
        // Store the normalized string we actually wrote (not `current`), so a
        // null/undefined field compares equal to '' on the next render instead
        // of churning every time (String(undefined) === 'undefined' !== '').
        this.lastFormValue = strValue;
        this.lastFormKind = 'value';
      }
    }

    // Attach the writeback listener exactly once per part lifecycle. Recreate
    // it when ANY of the captured inputs change: DOM property, event type, OR
    // the bound component/field — otherwise a `bind(otherComponent, 'field')`
    // re-render would keep writing to the old target.
    const eventName = bindEventFor(this.element, propName);
    if (
      this.bindListener &&
      (this.boundPropName !== propName ||
        this.boundComponent !== component ||
        this.boundFieldName !== bind.fieldName ||
        (this.bindListener as any).__eventName !== eventName)
    ) {
      this._detachBindListener();
    }
    if (!this.bindListener) {
      const listener = (e: Event) => {
        // `currentTarget` is the element the listener is registered on. Using
        // `target` would read from a bubbled child instead (e.g. an internal
        // input inside a custom element's shadow root).
        const source = e.currentTarget as Element & Record<string, any>;
        const next = propName === 'checked' ? !!source[propName] : source[propName];
        // Plain assignment on a `@State` field triggers requestUpdate on the
        // client (see cossack.ts setupStateProperty), driving the re-render.
        // Dot-paths write through setField so @Store nested writes hit the
        // reactive Proxy trap.
        if (component) setField(component, bind.fieldName, next);
      };
      (listener as any).__eventName = eventName;
      this.bindListener = listener;
      this.boundPropName = propName;
      this.boundComponent = component;
      this.boundFieldName = bind.fieldName;
      this.element.addEventListener(eventName, listener);

      if (propName === 'value') {
        const activeListener = listener;
        reapplySelectValueAfterChildren(
          this.element,
          () => this.bindListener === activeListener,
          () => resolveField(this.boundComponent, this.boundFieldName!),
        );
      }
    }

    // `.value`/`.checked` are not real HTML attributes — strip the binding
    // marker so it never appears in the DOM.
    if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
  }
}

/**
 * Dynamic <option> children are committed after select attribute/spread parts.
 * Browsers ignore a value with no matching option, so retry after the complete
 * template is applied, provided the original bind is still active.
 */
const reapplySelectValueAfterChildren = (
  element: Element,
  isActive: () => boolean,
  readValue: () => unknown,
): void => {
  if (!(element instanceof HTMLSelectElement)) return;
  queueMicrotask(() => {
    if (!isActive()) return;
    const current = readValue();
    const value = current == null ? '' : String(current);
    if (element.value !== value) element.value = value;
  });
};

/**
 * Pick the DOM event that signals a user edit for a given element + property.
 * Text-like inputs and textareas fire `input`; checkbox/radio/range inputs
 * and `<select>` update on `change`.
 */
const bindEventFor = (element: Element, propName: string): string => {
  if (element instanceof HTMLSelectElement) return 'change';
  if (element instanceof HTMLTextAreaElement) return 'input';
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (propName === 'checked' || type === 'checkbox' || type === 'radio' || type === 'range') {
      return 'change';
    }
    return 'input';
  }
  // Fall back to `input` for anything else (covers custom elements that
  // dispatch input events on edit).
  return 'input';
};

const containerCache = new WeakMap<Node, { identity: object; parts: Part[] }>();

/**
 * Compile a TemplateResult into a fresh DOM fragment with marker comments
 * (`<!--CRP_i-->` / `<!--/CRP-->`) for node positions and `__CRP_i__`
 * placeholders inside dynamic attributes, then walk it to create the Part
 * objects bound to those markers. The returned fragment has NOT had values
 * applied — the caller is responsible for `part.update(values[i])`.
 *
 * Shared by `render()` (append into a wiped container) and `hydrate()`
 * (rebind the parts to the existing SSR DOM).
 */
const compileTemplate = (result: TemplateResult): { fragment: Node; parts: Part[] } => {
  const parts: Part[] = [];
  const strings = scopeTemplateStrings(result.strings, result.__cossackScope);

  let htmlString = '';
  let isInsideTag = false;
  let insideAttrQuote: string | null = null; // tracks open quote char ('"' or "'")

  const attrMatch = /(\.\.\.|[.@?]?[a-zA-Z0-9_:-]+)=["']?$/;

  for (let i = 0; i < strings.length - 1; i++) {
    const str = strings[i];

    // Track whether we're inside a tag and inside an attribute quote
    for (let j = 0; j < str.length; j++) {
      if (insideAttrQuote) {
        if (str[j] === insideAttrQuote) insideAttrQuote = null;
      } else if (isInsideTag && (str[j] === '"' || str[j] === "'")) {
        if (j > 0 && str[j - 1] === '=') {
          insideAttrQuote = str[j];
        }
      } else if (str[j] === '<' && str[j + 1] !== '!' && str[j + 1] !== '/') {
        isInsideTag = true;
      } else if (str[j] === '>') {
        isInsideTag = false;
      }
    }

    htmlString += str;

    const match = str.match(attrMatch);
    if (isInsideTag && (match || insideAttrQuote)) {
      htmlString += `__CRP_${i}__`;
      // Track quote state from the regex match
      if (match && !insideAttrQuote) {
        const quote = match[0].endsWith('"') ? '"' : match[0].endsWith("'") ? "'" : null;
        if (quote) insideAttrQuote = quote;
      }
    } else {
      htmlString += `<!--CRP_${i}-->`;
    }
  }

  const lastStr = strings[strings.length - 1];
  for (let j = 0; j < lastStr.length; j++) {
    if (insideAttrQuote) {
      if (lastStr[j] === insideAttrQuote) insideAttrQuote = null;
    } else if (lastStr[j] === '<' && lastStr[j + 1] !== '!' && lastStr[j + 1] !== '/') {
      isInsideTag = true;
    } else if (lastStr[j] === '>') {
      isInsideTag = false;
    }
  }
  htmlString += lastStr;

  const template = document.createElement('template');
  if (result['_$litType$'] === 2) {
    // Parsing through an SVG element gives every fragment child the correct
    // namespace while allowing the HTML parser to switch back inside
    // <foreignObject>. Only the wrapper's children become template output.
    template.innerHTML = `<svg>${htmlString}</svg>`;
    const svgRoot = template.content.firstElementChild as SVGSVGElement | null;
    const fragment = document.createDocumentFragment();
    if (svgRoot) {
      while (svgRoot.firstChild) fragment.appendChild(svgRoot.firstChild);
    }
    template.content.replaceChildren(fragment);
  } else {
    template.innerHTML = htmlString;
  }
  const instance = template.content.cloneNode(true);

  const walker = document.createTreeWalker(instance, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  let currentNode: Node | null;

  const nodes: Node[] = [];
  while ((currentNode = walker.nextNode())) {
    nodes.push(currentNode);
  }

  nodes.forEach((node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      const match = node.nodeValue?.match(/CRP_(\d+)/);
      if (match) {
        const index = parseInt(match[1]);
        const endNode = document.createComment('/CRP');
        node.parentNode!.insertBefore(endNode, node.nextSibling);
        const part = new NodePart(node as Comment, endNode);
        parts[index] = part;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;

      Array.from(el.attributes).forEach((attr) => {
        const allMatches = [...attr.value.matchAll(/__CRP_(\d+)__/g)];
        if (allMatches.length === 0) return;

        if (allMatches.length === 1) {
          // Single-marker attribute: existing behavior preserved.
          const index = parseInt(allMatches[0][1]);
          if (!parts[index]) {
            if (attr.name === '...') {
              const part = new SpreadPart(el);
              parts[index] = part;
              el.removeAttribute('...');
            } else {
              const part = new AttributePart(el, attr.name, attr.value);
              parts[index] = part;
            }
          }
          return;
        }

        // Multi-marker attribute: create one AttributePart per marker,
        // all sharing the same currentValues array so the final
        // interpolation is correct once every part has been updated.
        if (attr.name === '...') {
          // Spread with multiple markers in one attribute is not supported.
          return;
        }
        const indices = allMatches.map((m) => parseInt(m[1]));
        const currentValues = new Array(allMatches.length).fill(undefined);
        for (let pos = 0; pos < indices.length; pos++) {
          const index = indices[pos];
          if (!parts[index]) {
            const part = new AttributePart(el, attr.name, attr.value, { currentValues, position: pos });
            parts[index] = part;
          }
        }
      });
    }
  });

  return { fragment: instance, parts };
};

export const render = (result: TemplateResult, container: Node) => {
  const existing = containerCache.get(container);
  const identity = templateIdentity(result);
  if (existing && existing.identity === identity) {
    existing.parts.forEach((part, i) => {
      part.update(result.values[i]);
    });
    return;
  }
  // Template changed (or first render). Dispose any existing parts so their
  // component instances (WebSockets, IntersectionObservers, listeners) are
  // torn down before we wipe the DOM and rebuild — otherwise re-rendering a
  // container with a different template leaks every old child component.
  if (existing) {
    for (const part of existing.parts) {
      if (part && typeof (part as any).dispose === 'function') (part as any).dispose();
    }
  }

  const { fragment, parts } = compileTemplate(result);
  const values = result.values;

  for (let i = 0; i < values.length; i++) {
    if (parts[i]) {
      parts[i].update(values[i]);
    }
  }

  if (
    (typeof HTMLElement !== 'undefined' && container instanceof HTMLElement) ||
    (typeof ShadowRoot !== 'undefined' && container instanceof ShadowRoot)
  ) {
    container.innerHTML = '';
  } else {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }
  container.appendChild(fragment);

  containerCache.set(container, { identity, parts });
};

/**
 * Error thrown when hydration cannot confidently match the existing DOM to the
 * template (structural mismatch). Caught by `hydrate()` which falls back to a
 * full `render()` so correctness is guaranteed even when adoption gives up.
 */
class HydrateMismatch extends Error {}

const describeNode = (n: Node | undefined): string => {
  if (!n) return '<none>';
  if (n.nodeType === Node.ELEMENT_NODE) return `<${(n as Element).nodeName.toLowerCase()}>`;
  if (n.nodeType === Node.COMMENT_NODE) return `<!--${n.nodeValue}-->`;
  if (n.nodeType === Node.TEXT_NODE) return `text"${(n.nodeValue || '').slice(0, 30)}"`;
  return `nodeType:${n.nodeType}`;
};

/**
 * A "filler" node: structurally insignificant and safe to skip during the
 * lockstep walk. Two kinds:
 *  - whitespace-only text nodes: SSR output is minified (whitespace between
 *    tags collapsed/removed) while the client blueprint is compiled from the
 *    unminified template, so the two differ only in these nodes.
 *  - non-CRP comments: `minifyHtml` strips user HTML comments in production,
 *    so the blueprint (which keeps them) must skip them to stay aligned.
 *    Cossack hydration markers (`<!--CRP_i-->`, `<!--/CRP-->`) are NOT filler —
 *    they anchor NodeParts and must be matched.
 */
const isFiller = (n: Node): boolean => {
  if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue || '').trim() === '';
  if (n.nodeType === Node.COMMENT_NODE) {
    const v = n.nodeValue || '';
    // Hydration markers (CRP node anchors + CSA list-item anchors) are
    // structurally significant and must be matched. All other comments are
    // stripped by minifyHtml in production and must be skipped.
    return !/^CRP_\d+$/.test(v) && v !== '/CRP' && v !== 'CSA-S' && v !== 'CSA-E';
  }
  return false;
};

/**
 * Find top-level `<!--CSA-S-->` / `<!--CSA-E-->` pairs in a node list. List
 * items can themselves be lists (nested arrays/repeat), so matching is
 * depth-aware: only pairs whose `CSA-E` returns the depth to zero are
 * returned as items of THIS list; nested pairs belong to a child part and
 * are resolved when that child adopts its own item.
 */
const findSequencePairs = (nodes: Node[]): [Comment, Comment][] => {
  const pairs: [Comment, Comment][] = [];
  const stack: Comment[] = [];
  for (const n of nodes) {
    if (n.nodeType !== Node.COMMENT_NODE) continue;
    const v = n.nodeValue;
    if (v === 'CSA-S') {
      stack.push(n as Comment);
    } else if (v === 'CSA-E') {
      const start = stack.pop();
      if (start && stack.length === 0) {
        pairs.push([start, n as Comment]);
      }
    }
  }
  return pairs;
};

/**
 * Walk a blueprint node-list and an existing node-list in lockstep, recording
 * the correspondence in `map`. The two lists share identical static structure;
 * they differ only where the blueprint has a marker pair `CRP_i` / `/CRP` and
 * the existing DOM has the rendered value nodes in between. Those value nodes
 * are skipped here — they are owned by the NodePart bound to the surrounding
 * marker comments. Whitespace-only text nodes are skipped on both sides so
 * that minified SSR output aligns with the unminified client blueprint.
 */
const reconcileNodeLists = (
  bpNodes: NodeListOf<ChildNode> | Node[],
  exNodes: Node[],
  map: Map<Node, Node>,
  path = 'root',
) => {
  let ei = 0;
  for (let bi = 0; bi < bpNodes.length; bi++) {
    const bpNode = bpNodes[bi];
    if (isFiller(bpNode)) continue; // skip blueprint whitespace-only text
    // Skip existing filler to stay aligned with the next meaningful node.
    while (ei < exNodes.length && isFiller(exNodes[ei])) ei++;
    const exNode = exNodes[ei];
    if (!exNode) throw new HydrateMismatch(`existing shorter than blueprint at ${path} (expected ${describeNode(bpNode)})`);
    // Elements must match by tag; text/comment nodes by type. Without the
    // tag check a <p> in the DOM would silently absorb a <div> template's
    // parts, producing a corrupted tree.
    if (bpNode.nodeType === Node.ELEMENT_NODE) {
      if (
        exNode.nodeType !== Node.ELEMENT_NODE ||
        bpNode.nodeName !== exNode.nodeName ||
        (bpNode as Element).namespaceURI !== (exNode as Element).namespaceURI
      ) {
        throw new HydrateMismatch(`tag mismatch: blueprint ${describeNode(bpNode)} vs existing ${describeNode(exNode)}`);
      }
      map.set(bpNode, exNode);
      reconcileNodeLists(
        bpNode.childNodes,
        Array.from(exNode.childNodes),
        map,
        `${path}/${bpNode.nodeName.toLowerCase()}[${bi}]`,
      );
    } else {
      if (bpNode.nodeType !== exNode.nodeType) {
        throw new HydrateMismatch(`type mismatch: blueprint ${describeNode(bpNode)} vs existing ${describeNode(exNode)}`);
      }
      map.set(bpNode, exNode);
    }
    ei++;
    // After a start marker, skip the existing value nodes up to the MATCHING
    // `/CRP`. Node-position values can themselves be templates that emit
    // nested `CRP`/`/CRP` marker pairs at the same level, so we track depth:
    // each nested start increments, each `/CRP` decrements; stop at depth 0.
    if (bpNode.nodeType === Node.COMMENT_NODE && /^CRP_\d+$/.test(bpNode.nodeValue || '')) {
      let depth = 1;
      while (ei < exNodes.length && depth > 0) {
        const cur = exNodes[ei];
        if (cur.nodeType === Node.COMMENT_NODE) {
          if (/^CRP_\d+$/.test(cur.nodeValue || '')) depth++;
          else if (cur.nodeValue === '/CRP') {
            depth--;
            if (depth === 0) break; // matched the outer /CRP; leave ei on it
          }
        }
        ei++;
      }
    }
  }
  // Ensure there are no remaining non-filler existing nodes. Without this,
  // hydration could "succeed" while leaving extra DOM behind (e.g. nodes
  // injected by a browser extension, or leftover SSR divergence) that no Part
  // manages and subsequent updates would never remove. Falling back to a full
  // render is the safe outcome.
  while (ei < exNodes.length && isFiller(exNodes[ei])) ei++;
  if (ei < exNodes.length) {
    throw new HydrateMismatch(`existing longer than blueprint (unexpected ${describeNode(exNodes[ei])})`);
  }
};

/**
 * Rebind compiled parts (initially bound to blueprint nodes) to the
 * corresponding existing DOM nodes recorded by `reconcileNodeLists`. Node
 * parts are additionally marked for one-shot adoption of their existing value
 * nodes. Called recursively for nested template adoption.
 */
const rebindParts = (parts: Part[], map: Map<Node, Node>) => {
  for (const part of parts) {
    if (!part) continue;
    if (part instanceof NodePart) {
      const start = map.get(part.startNode);
      const end = map.get(part.endNode);
      if (!start || !end) throw new HydrateMismatch('node part anchors not found');
      part.startNode = start as Comment;
      part.endNode = end as Comment;
      part._beginHydration();
    } else if (part instanceof AttributePart || part instanceof SpreadPart) {
      const el = map.get((part as any).element);
      if (!el) throw new HydrateMismatch('attribute part element not found');
      (part as any).element = el;
    }
  }
};

/**
 * Hydrate an existing container whose children were produced by SSR
 * (`renderToString(result, { hydrate: true })`). Binds Part objects to the
 * existing DOM nodes and adopts their SSR-rendered values instead of clearing
 * and rebuilding — preserving the server-rendered DOM (no flash, no lost
 * input/scroll, no duplicate component initialization).
 *
 * If the existing DOM cannot be confidently matched to the template, falls
 * back to a full `render()` so behaviour is always correct.
 */
export const hydrate = (result: TemplateResult, container: Node) => {
  // Nothing to hydrate (e.g. client-only render) — fall back to render.
  if (!container.hasChildNodes()) {
    return render(result, container);
  }
  // Already hydrated/managed by this template — use the fast update path.
  const cached = containerCache.get(container);
  const identity = templateIdentity(result);
  if (cached && cached.identity === identity) {
    cached.parts.forEach((part, i) => part.update(result.values[i]));
    return;
  }
  if (cached) {
    for (const part of cached.parts) {
      if (part && typeof (part as any).dispose === 'function') (part as any).dispose();
    }
  }

  let parts: Part[];
  try {
    const { fragment: blueprint, parts: compiled } = compileTemplate(result);
    parts = compiled;
    const map = new Map<Node, Node>();
    reconcileNodeLists(blueprint.childNodes, Array.from(container.childNodes), map);
    rebindParts(parts, map);
    for (let i = 0; i < result.values.length; i++) {
      if (parts[i]) parts[i]!.update(result.values[i]);
    }
  } catch (e) {
    if (e instanceof HydrateMismatch) {
      // Mismatch between SSR output and client template (divergent render
      // output, manual DOM edits, etc.). Safe fall back to a full render so
      // behaviour is always correct. Warn so the lost hydration is visible —
      // a silent fallback here would hide a real SSR/client divergence.
      console.warn('[cossack] hydration mismatch, falling back to render:', (e as Error).message);
      return render(result, container);
    }
    throw e;
  }

  containerCache.set(container, { identity, parts });
};
