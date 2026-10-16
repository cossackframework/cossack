/**
 * The template tree: elements, component tags, text and bindings of one
 * `html` or `svg` template, read from its static strings with the shared
 * tokenizer (`step`). `html` uses it to compile component tags; template
 * diagnostics and the app model use the same tree, so they see a template
 * exactly as the renderer does.
 *
 * Positions are `{ string, offset }` pairs: an offset in one of the
 * template's (cooked) strings. The binding with index `i` sits between
 * string `i` and string `i + 1`.
 */
import { createTokenizer, State, step } from './template-analysis';

export interface TemplateLocation {
  readonly string: number;
  readonly offset: number;
}

export interface TemplateRange {
  readonly start: TemplateLocation;
  readonly end: TemplateLocation;
}

export interface TemplateAttribute {
  /** The name as written, including a `.`, `?` or `@` prefix, or `...`. */
  readonly name: string;
  /** From the first character of the name to the end of the value. */
  readonly range: TemplateRange;
  readonly nameRange: TemplateRange;
  /** False for a bare attribute such as `disabled`. */
  readonly hasValue: boolean;
  readonly quote: '"' | "'" | '';
  /**
   * The value's static text around its bindings, as written (entities are
   * not decoded). Always one more entry than `bindings`.
   */
  readonly segments: readonly string[];
  readonly bindings: readonly number[];
}

export type TemplateNamespace = 'html' | 'svg' | 'mathml';

interface TagNode {
  readonly attributes: readonly TemplateAttribute[];
  /** Bindings in the start tag outside any attribute value. They render nothing. */
  readonly droppedBindings: readonly number[];
  readonly children: readonly TemplateNode[];
  /** From the start tag's `<` to the end of the end tag, or of the start tag. */
  readonly range: TemplateRange;
  readonly startTag: TemplateRange;
  /** The start tag ends with `/>`. */
  readonly selfClosing: boolean;
  readonly namespace: TemplateNamespace;
}

export interface TemplateElement extends TagNode {
  readonly type: 'element';
  /** The tag name as written. */
  readonly tag: string;
  /** The lowercase tag name. */
  readonly name: string;
  /** An end tag closed the element. Void and self-closing elements need none. */
  readonly closed: boolean;
}

/** `<${Card} ...>children</${Card}>` or `<${Card} ... />`. */
export interface TemplateComponent extends TagNode {
  readonly type: 'component';
  /** The binding that holds the component class. */
  readonly binding: number;
  /** The binding of the closing tag; null when self-closing or unclosed. */
  readonly closeBinding: number | null;
  /** Where the closing tag's `</` starts; null when self-closing or unclosed. */
  readonly closeStart: TemplateLocation | null;
}

export interface TemplateText {
  readonly type: 'text';
  /** As written: entities are not decoded. */
  readonly text: string;
  readonly range: TemplateRange;
}

/** A binding in node position, or in the text of a raw-text element. */
export interface TemplateBindingNode {
  readonly type: 'binding';
  readonly binding: number;
  /** Text of `<script>`, `<style>`, `<textarea>` or `<title>`. */
  readonly rawText: boolean;
}

export interface TemplateComment {
  readonly type: 'comment';
  readonly range: TemplateRange;
  readonly bindings: readonly number[];
}

export type TemplateNode = TemplateElement | TemplateComponent | TemplateText | TemplateBindingNode | TemplateComment;

export type TemplateBindingRole =
  | { readonly kind: 'node'; readonly parent: TemplateElement | TemplateComponent | null }
  | { readonly kind: 'raw-text'; readonly element: TemplateElement | null }
  | { readonly kind: 'attribute'; readonly owner: TemplateElement | TemplateComponent; readonly attribute: TemplateAttribute }
  | { readonly kind: 'tag'; readonly component: TemplateComponent; readonly closing: boolean }
  /** Inside a comment, a tag outside any attribute value, or an end tag. Renders nothing. */
  | { readonly kind: 'dropped'; readonly reason: 'comment' | 'tag' | 'end-tag' };

export type TemplateProblemCode =
  | 'COSSACK_TEMPLATE_UNTERMINATED'
  | 'COSSACK_TEMPLATE_DROPPED_BINDING'
  | 'COSSACK_TEMPLATE_UNCLOSED_ELEMENT'
  | 'COSSACK_TEMPLATE_UNEXPECTED_END_TAG'
  | 'COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT'
  | 'COSSACK_TEMPLATE_UNKNOWN_BINDING_PREFIX'
  | 'COSSACK_TEMPLATE_PREFIX_WITHOUT_BINDING'
  | 'COSSACK_TEMPLATE_PARTIAL_BINDING'
  | 'COSSACK_TEMPLATE_DUPLICATE_ATTRIBUTE'
  | 'COSSACK_TEMPLATE_UNCLOSED_COMPONENT'
  | 'COSSACK_TEMPLATE_UNEXPECTED_COMPONENT_END';

export interface TemplateProblem {
  readonly code: TemplateProblemCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly range: TemplateRange;
}

export interface ParsedTemplate {
  readonly nodes: readonly TemplateNode[];
  /** The role of each binding, by index. */
  readonly bindings: readonly TemplateBindingRole[];
  readonly problems: readonly TemplateProblem[];
}

/** Elements that never have content or an end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/** HTML elements whose end tag may be left out. */
const OPTIONAL_END_TAG = new Set([
  'html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'rt', 'rp', 'optgroup', 'option',
  'colgroup', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
]);

/** Start tags that close an open `<p>`. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'table', 'ul',
]);

const TABLE_SECTIONS = new Set(['thead', 'tbody', 'tfoot']);

/** True when a start tag `next` implicitly ends the open element `open`. */
const impliesEnd = (open: string, next: string): boolean => {
  switch (open) {
    case 'p': return CLOSES_P.has(next);
    case 'li': return next === 'li';
    case 'dt': case 'dd': return next === 'dt' || next === 'dd';
    case 'rt': case 'rp': return next === 'rt' || next === 'rp';
    case 'option': return next === 'option' || next === 'optgroup';
    case 'optgroup': return next === 'optgroup';
    case 'td': case 'th': return next === 'td' || next === 'th' || next === 'tr' || TABLE_SECTIONS.has(next);
    case 'tr': return next === 'tr' || TABLE_SECTIONS.has(next);
    case 'thead': case 'tbody': case 'tfoot': return TABLE_SECTIONS.has(next);
    default: return false;
  }
};

/** SVG elements whose children are HTML. */
const SVG_HTML_INTEGRATION = new Set(['foreignobject', 'desc', 'title']);

const childNamespace = (parent: TemplateNamespace, parentName: string): TemplateNamespace =>
  parent === 'svg' && SVG_HTML_INTEGRATION.has(parentName) ? 'html' : parent;

const elementNamespace = (inherited: TemplateNamespace, name: string): TemplateNamespace =>
  inherited === 'html' ? (name === 'svg' ? 'svg' : name === 'math' ? 'mathml' : 'html') : inherited;

// Mutable shapes used while parsing; the result exposes them read-only.
interface MutableAttribute {
  name: string;
  range: { start: TemplateLocation; end: TemplateLocation };
  nameRange: { start: TemplateLocation; end: TemplateLocation };
  hasValue: boolean;
  quote: '"' | "'" | '';
  segments: string[];
  bindings: number[];
}

interface MutableTag {
  component: boolean;
  /** The component's class binding, or -1. */
  binding: number;
  start: TemplateLocation;
  tag: string;
  attributes: MutableAttribute[];
  droppedBindings: number[];
  slash: boolean;
}

type Container = {
  node: (TemplateElement | TemplateComponent) & { children: TemplateNode[] } | null;
  children: TemplateNode[];
  namespace: TemplateNamespace;
};

const loc = (string: number, offset: number): TemplateLocation => ({ string, offset });

const NAME_AFTER_PREFIX = /^[A-Za-z_$][^\s"'>/=]*$/;
const PLAIN_NAME = /^[A-Za-z_][^\s"'>/=]*$/;

/**
 * Parse a template's static strings. `svg` selects the SVG namespace for the
 * template's top level, as for `svg` templates.
 */
export const parseTemplate = (strings: readonly string[], options: { svg?: boolean } = {}): ParsedTemplate => {
  const t = createTokenizer();
  const problems: TemplateProblem[] = [];
  const roles: TemplateBindingRole[] = [];
  const root: Container = { node: null, children: [], namespace: options.svg ? 'svg' : 'html' };
  const stack: Container[] = [root];
  const top = () => stack[stack.length - 1];

  const problem = (code: TemplateProblemCode, message: string, start: TemplateLocation, end: TemplateLocation, severity: 'error' | 'warning' = 'error') => {
    problems.push({ code, severity, message, range: { start, end } });
  };

  // Text of the current run (Data or RawText), within one string.
  let textStart = -1;
  let textString = -1;
  let text = '';
  let tag: MutableTag | null = null;
  let attr: MutableAttribute | null = null;
  // The end tag being read: where `</` starts, and the closing binding of a component.
  let endStart: TemplateLocation | null = null;
  let endText = '';
  // True until the first characters of an end tag opened by `</` are read.
  let endFresh = false;
  let endBinding = -1;
  let endDropped: number[] = [];
  let comment: { start: TemplateLocation; bindings: number[] } | null = null;

  const flushText = (string: number, end: number) => {
    if (textStart >= 0 && end > textStart) {
      top().children.push({ type: 'text', text, range: { start: loc(string, textStart), end: loc(string, end) } });
    }
    textStart = -1;
    textString = -1;
    text = '';
  };
  const addText = (string: number, from: number, chunk: string) => {
    if (textStart < 0 || textString !== string) {
      textStart = from;
      textString = string;
      text = '';
    }
    text += chunk;
  };

  const closeAttribute = (end: TemplateLocation) => {
    if (!attr || !tag) {
      attr = null;
      return;
    }
    if (attr.nameRange.end.offset < 0) attr.nameRange.end = end;
    // A bare attribute ends with its name, not at the next token.
    attr.range.end = attr.hasValue ? end : attr.nameRange.end;
    tag.attributes.push(attr);
    attr = null;
  };

  const unclosed = (node: TemplateElement | TemplateComponent) => {
    if (node.type === 'component') {
      problem('COSSACK_TEMPLATE_UNCLOSED_COMPONENT', 'The component tag has no closing tag. Close it with </${Component}> or end the start tag with />.',
        node.startTag.start, node.startTag.end);
    } else if (node.namespace !== 'html' || !OPTIONAL_END_TAG.has(node.name)) {
      problem('COSSACK_TEMPLATE_UNCLOSED_ELEMENT', `<${node.tag}> is not closed.`, node.startTag.start, node.startTag.end);
    }
  };

  // Pop the top container, ending its range at `end`.
  const pop = (end: TemplateLocation, report: boolean) => {
    const frame = stack.pop()!;
    const node = frame.node as any;
    node.range = { start: node.range.start, end };
    if (report) unclosed(frame.node!);
  };

  const finishStartTag = (string: number, end: number) => {
    const current = tag!;
    tag = null;
    const startTag = { start: current.start, end: loc(string, end) };
    const parent = top();
    if (current.component) {
      const node: TemplateComponent & { children: TemplateNode[] } = {
        type: 'component', binding: current.binding, closeBinding: null, closeStart: null,
        attributes: current.attributes, droppedBindings: current.droppedBindings, children: [],
        range: startTag, startTag, selfClosing: current.slash, namespace: parent.namespace,
      };
      parent.children.push(node);
      roles[current.binding] = { kind: 'tag', component: node, closing: false };
      for (const attribute of current.attributes) for (const index of attribute.bindings) roles[index] = { kind: 'attribute', owner: node, attribute };
      if (!current.slash) stack.push({ node, children: node.children, namespace: parent.namespace });
      return;
    }
    const name = current.tag.toLowerCase();
    // Start tags that end an open element the way the HTML parser does.
    while (stack.length > 1) {
      const open = top().node!;
      if (open.type !== 'element' || open.namespace !== 'html' || !impliesEnd(open.name, name)) break;
      pop(current.start, false);
    }
    const container = top();
    const namespace = elementNamespace(container.namespace, name);
    const isVoid = namespace === 'html' && VOID_ELEMENTS.has(name);
    const node: TemplateElement & { children: TemplateNode[] } = {
      type: 'element', tag: current.tag, name, namespace, attributes: current.attributes,
      droppedBindings: current.droppedBindings, children: [], range: startTag, startTag,
      selfClosing: current.slash, closed: isVoid || (current.slash && namespace !== 'html'),
    };
    container.children.push(node);
    for (const attribute of current.attributes) for (const index of attribute.bindings) roles[index] = { kind: 'attribute', owner: node, attribute };
    for (const index of current.droppedBindings) roles[index] = { kind: 'dropped', reason: 'tag' };
    if (isVoid) return;
    if (current.slash && namespace === 'html') {
      problem('COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT', `<${current.tag} /> does not close the element in HTML. Write <${current.tag}></${current.tag}>.`,
        startTag.start, startTag.end);
      (node as { closed: boolean }).closed = true;
      return;
    }
    if (node.closed) return;
    stack.push({ node, children: node.children, namespace: childNamespace(namespace, name) });
  };

  const finishEndTag = (string: number, end: number) => {
    const start = endStart!;
    const range = { start, end: loc(string, end) };
    endStart = null;
    const content = endText;
    endText = '';
    const dropped = endDropped;
    endDropped = [];
    for (const index of dropped) roles[index] = { kind: 'dropped', reason: 'end-tag' };
    if (endBinding >= 0) {
      const binding = endBinding;
      endBinding = -1;
      if (content.trim() !== '') {
        problem('COSSACK_TEMPLATE_DROPPED_BINDING', 'A component closing tag takes no attributes.', start, range.end);
      }
      let index = stack.length - 1;
      while (index > 0 && stack[index].node!.type !== 'component') index--;
      if (index === 0) {
        problem('COSSACK_TEMPLATE_UNEXPECTED_COMPONENT_END', 'This component closing tag has no open component tag.', start, range.end);
        roles[binding] = { kind: 'dropped', reason: 'end-tag' };
        return;
      }
      while (stack.length - 1 > index) pop(start, true);
      const node = top().node as TemplateComponent & { closeBinding: number | null; closeStart: TemplateLocation | null };
      node.closeBinding = binding;
      node.closeStart = start;
      roles[binding] = { kind: 'tag', component: node, closing: true };
      pop(range.end, false);
      return;
    }
    const written = content.match(/^[^\s/>]*/)![0];
    const name = written.toLowerCase();
    // The nearest open element with this name. An end tag may close an
    // element outside a component tag that was never closed.
    let index = stack.length - 1;
    while (index > 0) {
      const open = stack[index].node!;
      if (open.type === 'element' && open.name === name) break;
      index--;
    }
    if (index === 0) {
      problem('COSSACK_TEMPLATE_UNEXPECTED_END_TAG', VOID_ELEMENTS.has(name)
        ? `<${written}> is a void element and takes no end tag.`
        : `</${written}> has no open <${written}> element.`, start, range.end);
      return;
    }
    while (stack.length - 1 > index) pop(start, true);
    const node = top().node as TemplateElement & { closed: boolean };
    node.closed = true;
    pop(range.end, false);
  };

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    for (let j = 0; j < str.length;) {
      const ch = str[j];
      const from = t.state;
      const next = step(t, str, j);
      const to = t.state;
      switch (from) {
        case State.Data:
          if (to === State.Data) addText(i, j, str.slice(j, next));
          else {
            flushText(i, j);
            if (to === State.TagName) tag = { component: false, binding: -1, start: loc(i, j), tag: '', attributes: [], droppedBindings: [], slash: false };
            else if (to === State.EndTag) {
              endStart = loc(i, j);
              endFresh = true;
            } else comment = { start: loc(i, j), bindings: [] };
          }
          break;
        case State.TagName:
          if (to === State.TagName) tag!.tag += str.slice(j, next);
          break;
        case State.BeforeAttrName:
        case State.AfterAttrName:
          if (to === State.AttrName) {
            closeAttribute(loc(i, j));
            const start = loc(i, j);
            attr = { name: ch, range: { start, end: start }, nameRange: { start, end: loc(-1, -1) }, hasValue: false, quote: '', segments: [''], bindings: [] };
          } else if (to === State.BeforeAttrValue) {
            if (attr) attr.hasValue = true;
          } else if (to === State.Data || to === State.RawText) {
            closeAttribute(loc(i, j));
            // `slash` still describes the character before this `>`.
            if (tag) finishStartTag(i, j + 1);
            break;
          }
          // Only a `/` directly before `>` makes the tag self-closing.
          if (tag) tag.slash = ch === '/';
          break;
        case State.AttrName:
          if (to === State.AttrName) {
            if (attr) attr.name += str.slice(j, next);
          } else if (attr) {
            attr.nameRange.end = loc(i, j);
            if (to === State.BeforeAttrValue) attr.hasValue = true;
            else if (to === State.BeforeAttrName) closeAttribute(loc(i, j));
          }
          break;
        case State.BeforeAttrValue:
          if (to === State.AttrValueQuoted) {
            if (attr) attr.quote = t.quote;
          } else if (to === State.AttrValueUnquoted) {
            if (attr) attr.segments[attr.segments.length - 1] += str.slice(j, next);
          } else if (to === State.Data || to === State.RawText) {
            closeAttribute(loc(i, j));
            if (tag) finishStartTag(i, j + 1);
          }
          break;
        case State.AttrValueQuoted:
          if (to === State.AttrValueQuoted) {
            if (attr) attr.segments[attr.segments.length - 1] += str.slice(j, next);
          } else closeAttribute(loc(i, j + 1));
          break;
        case State.AttrValueUnquoted:
          if (to === State.AttrValueUnquoted) {
            if (attr) attr.segments[attr.segments.length - 1] += str.slice(j, next);
          } else closeAttribute(loc(i, j));
          break;
        case State.EndTag:
          if (to === State.EndTag) {
            const chunk = str.slice(j, next);
            // The `<` opened the end tag; skip its `/`.
            endText += endFresh && chunk.startsWith('/') ? chunk.slice(1) : chunk;
            endFresh = false;
          } else {
            endFresh = false;
            finishEndTag(i, j + 1);
          }
          break;
        case State.Comment:
        case State.BogusComment:
          if (to === State.Data && comment) {
            top().children.push({ type: 'comment', range: { start: comment.start, end: loc(i, next) }, bindings: comment.bindings });
            comment = null;
          }
          break;
        case State.RawText:
          if (to === State.RawText) addText(i, j, str.slice(j, next));
          else {
            flushText(i, j);
            endStart = loc(i, j);
            endFresh = true;
          }
          break;
      }
      j = next;
    }

    if (i === strings.length - 1) {
      flushText(i, str.length);
      break;
    }

    // Classify the binding between string `i` and string `i + 1`.
    const at = loc(i, str.length);
    const binding = i;
    switch (t.state) {
      case State.Data:
        if (str.endsWith('</')) {
          // `</${Card}>`: a component's closing tag.
          if (textStart >= 0) text = text.slice(0, -2);
          flushText(i, str.length - 2);
          t.state = State.EndTag;
          endStart = loc(i, str.length - 2);
          endText = '';
          endBinding = binding;
          roles[binding] = { kind: 'dropped', reason: 'end-tag' };
        } else if (str.endsWith('<')) {
          // `<${Card} ...>`: a component's start tag.
          if (textStart >= 0) text = text.slice(0, -1);
          flushText(i, str.length - 1);
          t.state = State.BeforeAttrName;
          t.tagName = '';
          tag = { component: true, binding, start: loc(i, str.length - 1), tag: '', attributes: [], droppedBindings: [], slash: false };
          roles[binding] = { kind: 'dropped', reason: 'tag' };
        } else {
          flushText(i, str.length);
          const parent = top().node;
          top().children.push({ type: 'binding', binding, rawText: false });
          roles[binding] = { kind: 'node', parent };
        }
        break;
      case State.RawText: {
        flushText(i, str.length);
        const parent = top().node;
        top().children.push({ type: 'binding', binding, rawText: true });
        roles[binding] = { kind: 'raw-text', element: parent?.type === 'element' ? parent : null };
        break;
      }
      case State.Comment:
      case State.BogusComment:
        comment?.bindings.push(binding);
        roles[binding] = { kind: 'dropped', reason: 'comment' };
        problem('COSSACK_TEMPLATE_DROPPED_BINDING', 'A binding inside an HTML comment renders nothing.', at, loc(i + 1, 0));
        break;
      case State.BeforeAttrValue:
      case State.AttrValueQuoted:
      case State.AttrValueUnquoted:
        if (attr) {
          attr.bindings.push(binding);
          attr.segments.push('');
          // Resolved to the attribute when its tag ends.
          roles[binding] = { kind: 'dropped', reason: 'tag' };
          if (t.state === State.BeforeAttrValue) t.state = State.AttrValueUnquoted;
        } else {
          tag?.droppedBindings.push(binding);
          roles[binding] = { kind: 'dropped', reason: 'tag' };
          problem('COSSACK_TEMPLATE_DROPPED_BINDING', 'This binding interrupts an attribute name and renders nothing.', at, loc(i + 1, 0));
        }
        break;
      case State.EndTag:
        endDropped.push(binding);
        roles[binding] = { kind: 'dropped', reason: 'end-tag' };
        problem('COSSACK_TEMPLATE_DROPPED_BINDING', 'A binding inside an end tag renders nothing.', at, loc(i + 1, 0));
        break;
      default:
        // In a tag name, between attributes, or interrupting an attribute name.
        if (t.state === State.AttrName || t.state === State.AfterAttrName) {
          if (attr) attr.nameRange.end = at;
          closeAttribute(at);
        }
        tag?.droppedBindings.push(binding);
        roles[binding] = { kind: 'dropped', reason: 'tag' };
        problem('COSSACK_TEMPLATE_DROPPED_BINDING', 'A binding in a tag must be an attribute value (name=${value}) or a spread (...=${props}). This one renders nothing.',
          at, loc(i + 1, 0));
        break;
    }
  }

  const last = strings.length - 1;
  const end = loc(last, strings[last]?.length ?? 0);
  switch (t.state) {
    case State.Data:
    case State.RawText:
      break;
    case State.Comment:
    case State.BogusComment:
      problem('COSSACK_TEMPLATE_UNTERMINATED', 'The template ends inside a comment.', comment?.start ?? end, end);
      break;
    case State.EndTag:
      if (endStart) problem('COSSACK_TEMPLATE_UNTERMINATED', 'The template ends inside an end tag.', endStart, end);
      break;
    default:
      if (tag) {
        if (attr) closeAttribute(end);
        problem('COSSACK_TEMPLATE_UNTERMINATED', 'The template ends inside a start tag.', tag.start, end);
        finishStartTag(last, end.offset);
      }
      break;
  }
  while (stack.length > 1) pop(end, true);

  checkAttributes(root.children, problems);
  return { nodes: root.children, bindings: roles, problems };
};

/** Attribute rules that need no types: binding forms and duplicates. */
const checkAttributes = (nodes: readonly TemplateNode[], problems: TemplateProblem[]) => {
  for (const node of nodes) {
    if (node.type !== 'element' && node.type !== 'component') continue;
    const seen = new Set<string>();
    for (const attribute of node.attributes) {
      const { name, bindings } = attribute;
      const prefix = name[0];
      const report = (code: TemplateProblemCode, message: string, severity: 'error' | 'warning' = 'error') =>
        problems.push({ code, severity, message, range: attribute.range });
      const whole = bindings.length === 1 && attribute.segments.every((segment) => segment === '');
      if (name === '...') {
        if (!whole) report('COSSACK_TEMPLATE_PARTIAL_BINDING', 'A spread takes one whole value: ...=${props}.');
        continue;
      }
      if (prefix === '.' || prefix === '?' || prefix === '@') {
        const label = prefix === '.' ? 'property' : prefix === '?' ? 'boolean attribute' : 'event';
        if (!NAME_AFTER_PREFIX.test(name.slice(1))) {
          report('COSSACK_TEMPLATE_UNKNOWN_BINDING_PREFIX', `"${name}" is not a valid ${label} binding name.`);
        } else if (bindings.length === 0) {
          report('COSSACK_TEMPLATE_PREFIX_WITHOUT_BINDING', `The ${label} binding ${name} needs a value: ${name}=\${value}.`);
        } else if (!whole) {
          report('COSSACK_TEMPLATE_PARTIAL_BINDING', `The ${label} binding ${name} takes one whole value: ${name}=\${value}.`);
        }
      } else if (bindings.length > 0 && !PLAIN_NAME.test(name)) {
        report('COSSACK_TEMPLATE_UNKNOWN_BINDING_PREFIX', `"${name}" has an unknown binding prefix. Use name=, .property=, ?boolean=, @event= or ...=.`);
      }
      const key = node.type === 'element' && node.namespace === 'html' ? name.toLowerCase() : name;
      if (seen.has(key)) {
        report('COSSACK_TEMPLATE_DUPLICATE_ATTRIBUTE', node.type === 'element'
          ? `${name} is set more than once. The element keeps only the first.`
          : `${name} is set more than once. The last value is used.`, 'warning');
      }
      seen.add(key);
    }
    checkAttributes(node.children, problems);
  }
};
