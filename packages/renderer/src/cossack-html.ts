import { ComponentResult, isComponentResult } from './component';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { LiveResult, RepeatResult, KeyResult, BindResult } from './directives';

export class TemplateResult {
  public readonly _cossack_template_result = true;
  constructor(
    public readonly strings: TemplateStringsArray,
    public readonly values: unknown[],
  ) {}
}

export const html = (strings: TemplateStringsArray, ...values: unknown[]) => {
  return new TemplateResult(strings, values);
};


export const component = <T extends CossackElement>(
  clazz: new () => T,
  props: Record<string, unknown> = {},
  children?: unknown,
): TemplateResult => {
  const raw: ComponentResult = {
    _type: 'COMPONENT',
    clazz,
    props,
    children,
  };
  return html`${raw}`;
};

export const isTemplateResult = (value: unknown): value is TemplateResult => {
  return typeof value === 'object' && value !== null && (value as any)._cossack_template_result === true;
};

export class UnsafeHTMLResult {
  constructor(public readonly value: string) {}
}

export const unsafeHTML = (value: string) => new UnsafeHTMLResult(value);

export const isUnsafeHTML = (value: unknown): value is UnsafeHTMLResult => {
  return value instanceof UnsafeHTMLResult;
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
  if (value === null || value === undefined || value === false) {
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
  if (value instanceof BindResult) {
    // SSR for two-way binding: emit the current field value. The DOM property
    // name (value/checked) is determined by the attribute this BindResult is
    // attached to, which the SSR scanner handles via its `.startsWith('.')`
    // branch and calls valueToString here. Writeback listeners are a
    // client-only concern.
    const current = (value.component as any)?.[value.fieldName];
    return valueToString(current, opts);
  }
  if (isComponentResult(value)) {
    const instance = new value.clazz();
    Object.assign(instance, value.props);
    if ('props' in instance) {
      (instance as any).props = value.props;
    }
    instance.children = value.children;
    instance.__parent = CossackElement.currentRenderingInstance;

    // Set up _id for nested components (same logic as updateComponent)
    if (instance.__parent) {
      instance._id = `${instance.__parent._id}:${(instance.__parent as any)._childCounter++}`;
    }

    // Call connectedCallback to register the component (needed for activeComponents)
    instance.connectedCallback();

    pushCurrentInstance(instance);
    (instance as any).willUpdate(new Map());
    const template = instance.render();
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

const renderSpread = (obj: unknown): string => {
  let output = '';
  if (typeof obj === 'object' && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@')) continue;

      let name = k;
      let val = v;

      if (k.startsWith('?')) {
        if (v) output += ` ${k.slice(1)}`;
        continue;
      }
      if (k.startsWith('.')) {
        name = k.slice(1);
      }

      if (typeof val === 'boolean') {
        if (val) output += ` ${name}`;
      } else if (typeof val === 'function') {
        // Ignore
      } else if (val !== null && val !== undefined) {
        output += ` ${name}="${escapeHtml(val)}"`;
      }
    }
  }
  return output;
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
const classifyPositions = (strings: TemplateStringsArray): boolean[] => {
  const isNode: boolean[] = [];
  let isInsideTag = false;
  let insideAttrQuote: string | null = null;
  const attrMatch = /(\.\.\.|[.@?]?[a-zA-Z0-9_-]+)=["']?$/;
  for (let i = 0; i < strings.length - 1; i++) {
    const str = strings[i];
    for (let j = 0; j < str.length; j++) {
      if (insideAttrQuote) {
        if (str[j] === insideAttrQuote) insideAttrQuote = null;
      } else if (str[j] === '"' || str[j] === "'") {
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

class SSRScanner {
  private result: string = '';
  private stringIdx = 0;
  private charIdxForNext = 0;
  private isNodePositions: boolean[];

  constructor(private resultObj: TemplateResult, private opts: { hydrate?: boolean } = {}) {
    this.isNodePositions = classifyPositions(resultObj.strings);
  }

  scan(): string {
    const { strings, values } = this.resultObj;

    while (this.stringIdx < strings.length) {
      const str = strings[this.stringIdx];
      const remaining = str.substring(this.charIdxForNext || 0);

      const attrMatch = remaining.match(/(\.\.\.|[.@?]?[a-zA-Z0-9_-]+)=["']?$/);

      this.result += remaining;
      this.charIdxForNext = 0;

      if (this.stringIdx < strings.length - 1) {
        const val = values[this.stringIdx];
        if (attrMatch) {
          const fullMatch = attrMatch[0];
          const name = attrMatch[1];

          this.result = this.result.substring(0, this.result.length - fullMatch.length);

          // Check if we opened a quote
          const quote = fullMatch.endsWith('"') ? '"' : fullMatch.endsWith("'") ? "'" : '';

          let replaced = true;

          if (name === '...') {
            this.result = this.result.trimEnd();
            this.result += renderSpread(val);
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
              propVal = (val.component as any)?.[val.fieldName];
            } else {
              propVal = val;
            }
            const attrName = name.slice(1);
            // For `bind()` on a known boolean attribute (.checked/.disabled),
            // emit a bare attribute when truthy — matching how a checkbox
            // serializes. Plain (non-bind) property bindings keep their
            // original behavior (value="...") to avoid changing existing usage.
            const isBooleanAttr =
              isBind &&
              (attrName === 'checked' || attrName === 'disabled' || attrName === 'readonly' ||
                attrName === 'selected' || attrName === 'multiple' || attrName === 'required' ||
                attrName === 'hidden');
            if (isBooleanAttr) {
              this.result = this.result.trimEnd();
              if (propVal) this.result += ` ${attrName}`;
            } else if (propVal !== null && propVal !== undefined && propVal !== false) {
              this.result = this.result.trimEnd();
              this.result += ` ${attrName}="${valueToString(propVal, this.opts)}"`;
            } else {
              this.result = this.result.trimEnd();
            }
          } else {
            this.result += fullMatch;
            this.result += valueToString(val, this.opts);
            replaced = false;
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

class NodePart implements Part {
  private componentInstance: CossackElement | null = null;
  private renderListener: ((t: TemplateResult | unknown | null) => void) | null = null;
  private _childParts: NodePart[] = [];
  private _partKeys: unknown[] = [];
  // Cache for nested template result updates
  private _cachedTemplateStrings: TemplateStringsArray | null = null;
  private _cachedParts: Part[] | null = null;
  // Tracked key for the `key()` directive
  private _key: unknown = undefined;
  private _keySet = false;
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
    if (value === null || value === undefined || value === false) {
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
    if (this.componentInstance && this.componentInstance.constructor !== result.clazz) {
      this.disposeComponent();
    }
    if (!this.componentInstance) {
      this.componentInstance = new result.clazz();
      this.componentInstance.__parent = CossackElement.currentRenderingInstance;
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
    this._cachedTemplateStrings = value.strings;
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
    if (!this.componentInstance) {
      this.componentInstance = new result.clazz();
      this.componentInstance.__parent = CossackElement.currentRenderingInstance;
      if (this.componentInstance.__parent) {
        this.componentInstance._id = `${this.componentInstance.__parent._id}:${this.componentInstance.__parent._childCounter++}`;
      }
      this.renderListener = (template) => {
        this.updateNode(template);
      };
      this.componentInstance.addRenderListener(this.renderListener);
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
      if (this._cachedTemplateStrings === value.strings && this._cachedParts) {
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
          this._cachedTemplateStrings = cached.strings;
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
    } else if (value === null || value === undefined || value === false) {
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
    this._cachedTemplateStrings = null;
    this._cachedParts = null;
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
  constructor(public element: Element) {}
  update(value: unknown) {
    if (typeof value !== 'object' || value === null) return;
    const props = value as Record<string, unknown>;

    for (const key of Object.keys(this.previousValues)) {
      if (!(key in props)) {
        if (key.startsWith('@')) {
          const eventName = key.slice(1);
          const propName = `__crp_handler_${eventName}`;
          const oldHandler = (this.element as any)[propName];
          if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
        } else if (key.startsWith('.')) {
          // Prop
        } else if (key.startsWith('?')) {
          this.element.removeAttribute(key.slice(1));
        } else {
          this.element.removeAttribute(key);
        }
      }
    }

    for (const [key, val] of Object.entries(props)) {
      if (key.startsWith('@') && typeof val === 'function') {
        const eventName = key.slice(1);
        const propName = `__crp_handler_${eventName}`;
        const oldHandler = (this.element as any)[propName];
        if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
        (this.element as any)[propName] = val;
        this.element.addEventListener(eventName, val as EventListener);
      } else if (key.startsWith('.')) {
        (this.element as any)[key.slice(1)] = val;
      } else if (key.startsWith('?')) {
        if (val) this.element.setAttribute(key.slice(1), '');
        else this.element.removeAttribute(key.slice(1));
      } else if (typeof val === 'boolean') {
        if (val) this.element.setAttribute(key, '');
        else this.element.removeAttribute(key);
      } else if (val !== null && val !== undefined) {
        this.element.setAttribute(key, String(val));
      }
    }
    this.previousValues = { ...props };
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
  // and reuses this stored closure so re-renders don't pile up duplicates.
  private bindListener: ((e: Event) => void) | null = null;
  private boundPropName: string | null = null;

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
    let isLive = false;
    if (value instanceof LiveResult) {
      isLive = true;
      value = value.value;
    }
    if (value instanceof BindResult) {
      this.updateBind(value);
      return;
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
      let result = this.segments[0];
      for (let i = 0; i < currentValues.length; i++) {
        result += String(currentValues[i]) + this.segments[i + 1];
      }
      this.element.setAttribute(this.name, result);
      return;
    }

    if (this.name.startsWith('@') && typeof value === 'function') {
      // Event handlers are typically inline arrows (`@input="${(e) => ...}"`),
      // which produce a NEW function reference on every render. Naively
      // removeEventListener(old)+addEventListener(new) on each update churns
      // the listener and — critically — if a re-render happens during event
      // dispatch (e.g. a `bind()` writeback triggers requestUpdate), the
      // handler for the CURRENT event can be removed before it fires.
      //
      // Fix: register a single STABLE wrapper once, and have it delegate to
      // the latest handler stored on the element. Updates just swap the stored
      // ref; the registered listener never changes identity, so there is no
      // remove/add during dispatch.
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
      (this.element as any)[handlerProp] = value;
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
    } else if (typeof value === 'boolean') {
      if (value) this.element.setAttribute(this.name, '');
      else this.element.removeAttribute(this.name);
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
      (this.element as any)[propName] = (bind.component as any)?.[bind.fieldName];
      if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
      return;
    }

    const el = this.element as any;
    const component = bind.component as any;

    // Render direction: push current field value into the DOM (dirty-checked
    // against the last value we committed, so an unchanged field — e.g. the
    // user is mid-edit and nothing else changed — is left alone).
    const current = component?.[bind.fieldName];
    if (propName === 'checked') {
      const boolValue = Boolean(current);
      if (this.lastFormKind !== 'checked' || this.lastFormValue !== boolValue) {
        el.checked = boolValue;
        this.lastFormValue = boolValue;
        this.lastFormKind = 'checked';
      }
    } else {
      const strValue = current == null ? '' : String(current);
      if (this.lastFormKind !== 'value' || String(this.lastFormValue) !== strValue) {
        el.value = strValue;
        this.lastFormValue = current;
        this.lastFormKind = 'value';
      }
    }

    // Attach the writeback listener exactly once per part lifecycle. If the
    // field name or DOM event type changes (e.g. the element was rebuilt with
    // a different type), swap the listener out.
    const eventName = bindEventFor(this.element, propName);
    if (
      this.bindListener &&
      (this.boundPropName !== propName || (this.bindListener as any).__eventName !== eventName)
    ) {
      const prev = this.bindListener as any;
      this.element.removeEventListener(prev.__eventName, prev);
      this.bindListener = null;
    }
    if (!this.bindListener) {
      const listener = (e: Event) => {
        const target = e.target as any;
        const next = propName === 'checked' ? !!target[propName] : target[propName];
        // Plain assignment on a `@State` field triggers requestUpdate on the
        // client (see cossack.ts setupStateProperty), driving the re-render.
        if (component) component[bind.fieldName] = next;
      };
      (listener as any).__eventName = eventName;
      this.bindListener = listener;
      this.boundPropName = propName;
      this.element.addEventListener(eventName, listener);
    }

    // `.value`/`.checked` are not real HTML attributes — strip the binding
    // marker so it never appears in the DOM.
    if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
  }
}

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

const containerCache = new WeakMap<Node, { strings: TemplateStringsArray; parts: Part[] }>();

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

  let htmlString = '';
  let isInsideTag = false;
  let insideAttrQuote: string | null = null; // tracks open quote char ('"' or "'")

  const attrMatch = /(\.\.\.|[.@?]?[a-zA-Z0-9_-]+)=["']?$/;

  for (let i = 0; i < result.strings.length - 1; i++) {
    const str = result.strings[i];

    // Track whether we're inside a tag and inside an attribute quote
    for (let j = 0; j < str.length; j++) {
      if (insideAttrQuote) {
        if (str[j] === insideAttrQuote) insideAttrQuote = null;
      } else if (str[j] === '"' || str[j] === "'") {
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

  const lastStr = result.strings[result.strings.length - 1];
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
  template.innerHTML = htmlString;
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
  if (existing && existing.strings === result.strings) {
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

  if (container instanceof HTMLElement) {
    container.innerHTML = '';
    container.appendChild(fragment);
  } else if (container instanceof DocumentFragment) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(fragment);
  }

  containerCache.set(container, { strings: result.strings, parts });
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
) => {
  let ei = 0;
  for (let bi = 0; bi < bpNodes.length; bi++) {
    const bpNode = bpNodes[bi];
    if (isFiller(bpNode)) continue; // skip blueprint whitespace-only text
    // Skip existing filler to stay aligned with the next meaningful node.
    while (ei < exNodes.length && isFiller(exNodes[ei])) ei++;
    const exNode = exNodes[ei];
    if (!exNode) throw new HydrateMismatch(`existing shorter than blueprint (expected ${describeNode(bpNode)})`);
    // Elements must match by tag; text/comment nodes by type. Without the
    // tag check a <p> in the DOM would silently absorb a <div> template's
    // parts, producing a corrupted tree.
    if (bpNode.nodeType === Node.ELEMENT_NODE) {
      if (exNode.nodeType !== Node.ELEMENT_NODE || bpNode.nodeName !== exNode.nodeName) {
        throw new HydrateMismatch(`tag mismatch: blueprint ${describeNode(bpNode)} vs existing ${describeNode(exNode)}`);
      }
      map.set(bpNode, exNode);
      reconcileNodeLists(bpNode.childNodes, Array.from(exNode.childNodes), map);
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
  if (cached && cached.strings === result.strings) {
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

  containerCache.set(container, { strings: result.strings, parts });
};
