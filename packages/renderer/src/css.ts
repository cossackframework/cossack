// css-tree is deliberately bundled into the renderer build. It is a pure
// JavaScript parser, so style finalization works in browsers, Node.js, and
// Cloudflare Workers without relying on a DOM or Node-specific APIs.
// @ts-expect-error css-tree 3 does not publish TypeScript declarations.
import { generate, parse, walk } from 'css-tree';

const CSS_RESULT_TOKEN = Symbol('cossack-css-result');

/** A safely constructed block of component CSS. */
export class CSSResult {
  readonly cssText: string;

  /** @internal Use css`` or unsafeCSS() instead. */
  constructor(cssText: string, token: symbol) {
    if (token !== CSS_RESULT_TOKEN) {
      throw new Error('[cossack/renderer] CSSResult cannot be constructed directly. Use css`` or unsafeCSS().');
    }
    this.cssText = cssText;
  }

  toString(): string {
    return this.cssText;
  }
}

export type CSSResultGroup = CSSResult | readonly CSSResultGroup[];

const createCSSResult = (text: string): CSSResult => new CSSResult(text, CSS_RESULT_TOKEN);

/**
 * Construct component CSS. Interpolations are intentionally restricted to
 * numbers and other CSSResult values; use unsafeCSS() for reviewed raw text.
 */
export const css = (strings: TemplateStringsArray, ...values: unknown[]): CSSResult => {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === 'number') {
      text += String(value);
    } else if (value instanceof CSSResult) {
      text += value.cssText;
    } else {
      throw new Error(
        '[cossack/renderer] css`` interpolations must be numbers or CSSResult values. ' +
        'Use unsafeCSS() only for explicitly trusted raw CSS.',
      );
    }
    text += strings[i + 1];
  }
  return createCSSResult(text);
};

/** Mark a reviewed raw value as trusted CSS for interpolation into css``. */
export const unsafeCSS = (value: unknown): CSSResult => createCSSResult(String(value));

export interface FinalizedStyles {
  readonly cssText: string;
  readonly scopeId: string;
}

const finalizedStyles = new WeakMap<Function, FinalizedStyles | null>();

const flattenStyles = (value: unknown, output: CSSResult[]): void => {
  if (Array.isArray(value)) {
    for (const nested of value) flattenStyles(nested, output);
    return;
  }
  if (value instanceof CSSResult) {
    output.push(value);
    return;
  }
  throw new TypeError(
    '[cossack/renderer] static styles must contain only CSSResult values returned by css`` or unsafeCSS().',
  );
};

const dedupeKeepingLast = (values: CSSResult[]): CSSResult[] => {
  const seen = new Set<CSSResult>();
  const result: CSSResult[] = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  result.reverse();
  return result;
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

const scopeAttributeNode = (scopeId: string): any => {
  const selector = parse(`[data-cossack-scope="${scopeId}"]`, { context: 'selector' }) as any;
  return selector.children.first;
};

const attributeName = (node: any): string | undefined => {
  if (node?.type !== 'AttributeSelector') return undefined;
  return typeof node.name === 'string' ? node.name : node.name?.name;
};

const scopeSelector = (selector: any, scopeId: string): void => {
  const children = selector.children;
  if (!children) return;

  // Functional selector arguments are selector lists in css-tree. Scope them
  // recursively before adding the attribute to the containing compound.
  children.forEach((node: any) => {
    if (node.type === 'PseudoClassSelector') {
      const name = String(node.name).toLowerCase();
      if (name === 'host' || name === 'host-context') {
        throw new Error(`[cossack/renderer] Shadow DOM selector :${name} is not supported by Light DOM scoped styles.`);
      }
      if (node.children) {
        node.children.forEach((child: any) => {
          if (child.type === 'SelectorList') {
            child.children.forEach((nested: any) => scopeSelector(nested, scopeId));
          }
        });
      }
    } else if (node.type === 'PseudoElementSelector' && String(node.name).toLowerCase() === 'slotted') {
      throw new Error('[cossack/renderer] Shadow DOM selector ::slotted is not supported by Light DOM scoped styles.');
    }
  });

  let compoundStart = children.head;
  let item = children.head;
  while (item) {
    const next = item.next;
    if (item.data.type === 'Combinator') {
      addScopeToCompound(children, compoundStart, item, scopeId);
      compoundStart = next;
    }
    item = next;
  }
  addScopeToCompound(children, compoundStart, null, scopeId);
};

const addScopeToCompound = (list: any, start: any, end: any, scopeId: string): void => {
  if (!start || start === end) return;
  let cursor = start;
  let insertionPoint = end;
  let alreadyScoped = false;
  while (cursor && cursor !== end) {
    if (attributeName(cursor.data) === 'data-cossack-scope') alreadyScoped = true;
    if (
      (cursor.data.type === 'PseudoClassSelector' || cursor.data.type === 'PseudoElementSelector') &&
      insertionPoint === end
    ) insertionPoint = cursor;
    cursor = cursor.next;
  }
  if (!alreadyScoped) list.insertData(scopeAttributeNode(scopeId), insertionPoint);
};

const rewriteStylesheet = (ast: any, scopeId: string): string => {
  const keyframes = new Map<string, string>();

  walk(ast, {
    visit: 'Atrule',
    enter(node: any) {
      const atName = String(node.name).toLowerCase();
      if (atName !== 'keyframes' && atName !== '-webkit-keyframes') return;
      const nameNode = node.prelude?.children?.first;
      const oldName = nameNode?.name ?? nameNode?.value;
      if (typeof oldName !== 'string') return;
      const nextName = `${scopeId}-${oldName}`;
      keyframes.set(oldName, nextName);
      if ('name' in nameNode) nameNode.name = nextName;
      else nameNode.value = nextName;
    },
  });

  walk(ast, {
    visit: 'Rule',
    enter(this: any, node: any) {
      const containingAtRule = String(this.atrule?.name ?? '').toLowerCase();
      if (containingAtRule === 'keyframes' || containingAtRule === '-webkit-keyframes') return;
      if (node.prelude?.type === 'SelectorList') {
        node.prelude.children.forEach((selector: any) => scopeSelector(selector, scopeId));
      }
    },
  });

  if (keyframes.size > 0) {
    walk(ast, {
      visit: 'Declaration',
      enter(node: any) {
        const property = String(node.property).toLowerCase();
        if (property !== 'animation' && property !== 'animation-name' &&
            property !== '-webkit-animation' && property !== '-webkit-animation-name') return;
        walk(node.value, (valueNode: any) => {
          if (valueNode.type !== 'Identifier' && valueNode.type !== 'String') return;
          const oldName = valueNode.name ?? valueNode.value;
          const nextName = keyframes.get(oldName);
          if (!nextName) return;
          if ('name' in valueNode) valueNode.name = nextName;
          else valueNode.value = nextName;
        });
      },
    });
  }

  return generate(ast);
};

/** @internal Finalize and cache a component class's Light DOM styles. */
export const getFinalizedStyles = (componentClass: Function & { styles?: CSSResultGroup }): FinalizedStyles | null => {
  if (finalizedStyles.has(componentClass)) return finalizedStyles.get(componentClass)!;
  const declared = componentClass.styles;
  if (declared === undefined) {
    finalizedStyles.set(componentClass, null);
    return null;
  }

  const flat: CSSResult[] = [];
  flattenStyles(declared, flat);
  const cssText = dedupeKeepingLast(flat).map((result) => result.cssText).join('\n');
  const ast = parse(cssText, { context: 'stylesheet', parseCustomProperty: true }) as any;
  const normalized = generate(ast);
  const scopeId = `c${fnv1a(normalized)}`;
  const scoped = rewriteStylesheet(ast, scopeId);
  const result = { cssText: scoped, scopeId };
  finalizedStyles.set(componentClass, result);
  return result;
};
