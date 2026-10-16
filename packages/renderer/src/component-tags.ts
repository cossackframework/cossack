/**
 * Component tags: `<${Card} hoverable padding="sm">children</${Card}>`.
 *
 * `html` and `svg` compile a template that contains component tags once per
 * call site into a plan: the template's strings with every component tag
 * replaced by one node binding, and for each tag how to build its props and
 * children from the template's values. Each call then builds the same
 * component() result that `component(Card, { hoverable: true, padding: 'sm' },
 * html`children`)` returns, so SSR, hydration, drafts and service scopes see
 * no difference between the two forms.
 */
import { parseTemplate, type TemplateComponent, type TemplateLocation, type TemplateNode } from './template-parse';

/** One prop, in source order: later props and spreads override earlier ones. */
export type ComponentPropPlan =
  /** `name="text"` (entities decoded) or a bare `name` (true). */
  | { readonly kind: 'static'; readonly name: string; readonly value: string | true }
  /** `name=${value}`: the value as is. */
  | { readonly kind: 'value'; readonly name: string; readonly binding: number }
  /** `name="a ${b}"`: text, the same as an interpolated attribute. */
  | { readonly kind: 'text'; readonly name: string; readonly segments: readonly string[]; readonly bindings: readonly number[] }
  /** `...=${props}`. */
  | { readonly kind: 'spread'; readonly binding: number };

export type ComponentChildrenPlan =
  | { readonly kind: 'none' }
  /** Static text without markup or entities. */
  | { readonly kind: 'text'; readonly text: string }
  /** One binding or component tag with only whitespace around it. */
  | { readonly kind: 'slot'; readonly slot: TemplateSlot }
  | { readonly kind: 'template'; readonly plan: TemplatePlan };

export interface ComponentPlan {
  /** The binding that holds the component class. */
  readonly binding: number;
  /** The binding of the closing tag, which must hold the same class. */
  readonly closeBinding: number | null;
  readonly props: readonly ComponentPropPlan[];
  readonly children: ComponentChildrenPlan;
}

/** A value of the compiled template: an original binding, or a component. */
export type TemplateSlot = number | ComponentPlan;

export interface TemplatePlan {
  /** Identity-stable strings, so the compiled template is cached like any other. */
  readonly strings: TemplateStringsArray;
  readonly slots: readonly TemplateSlot[];
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the character references a static attribute value commonly uses. */
export const decodeEntities = (text: string): string => text.includes('&')
  ? text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  })
  : text;

const stringsArray = (strings: string[]): TemplateStringsArray =>
  Object.freeze(Object.assign(strings, { raw: Object.freeze([...strings]) })) as unknown as TemplateStringsArray;

/** True when a template might contain component tags; the parse decides. */
export const mayContainComponentTags = (strings: readonly string[]): boolean => {
  for (let i = 0; i < strings.length - 1; i++) {
    const str = strings[i];
    if (str.charCodeAt(str.length - 1) === 60 /* < */ || str.endsWith('</')) return true;
  }
  return false;
};

/** Component tags in `nodes`, through elements but not into other components. */
const outerComponents = (nodes: readonly TemplateNode[], out: TemplateComponent[] = []): TemplateComponent[] => {
  for (const node of nodes) {
    if (node.type === 'component') out.push(node);
    else if (node.type === 'element') outerComponents(node.children, out);
  }
  return out;
};

const isBlank = (text: string) => text.trim() === '';

/**
 * Compile the component tags of a template. Returns null when it has none.
 * Throws for a component tag that is never closed or a closing tag without
 * an opening one: the template has no meaning then.
 */
export const compileComponentTags = (input: readonly string[], options: { svg?: boolean } = {}): TemplatePlan | null => {
  const parsed = parseTemplate(input, options);
  const broken = parsed.problems.find((problem) =>
    problem.code === 'COSSACK_TEMPLATE_UNCLOSED_COMPONENT' || problem.code === 'COSSACK_TEMPLATE_UNEXPECTED_COMPONENT_END');
  if (broken) throw new Error(`[cossack/renderer] ${broken.message}`);
  if (outerComponents(parsed.nodes).length === 0) return null;

  const region = (start: TemplateLocation, end: TemplateLocation, nodes: readonly TemplateNode[]): TemplatePlan => {
    const tags = outerComponents(nodes);
    const strings: string[] = [];
    const slots: TemplateSlot[] = [];
    let current = '';
    let string = start.string;
    let from = start.offset;
    let next = 0;
    for (;;) {
      const tag = tags[next];
      if (tag && tag.startTag.start.string === string) {
        // The tag's `<` ends this string; everything up to its end becomes one slot.
        strings.push(current + input[string].slice(from, tag.startTag.start.offset));
        current = '';
        slots.push(componentPlan(tag));
        string = tag.range.end.string;
        from = tag.range.end.offset;
        next++;
        continue;
      }
      if (string === end.string) {
        strings.push(current + input[string].slice(from, end.offset));
        break;
      }
      strings.push(current + input[string].slice(from));
      current = '';
      slots.push(string);
      string++;
      from = 0;
    }
    return { strings: stringsArray(strings), slots };
  };

  const componentPlan = (tag: TemplateComponent): ComponentPlan => {
    const props: ComponentPropPlan[] = [];
    for (const attribute of tag.attributes) {
      const { name, bindings, segments } = attribute;
      if (name === '...') {
        if (bindings.length === 1) props.push({ kind: 'spread', binding: bindings[0] });
      } else if (!attribute.hasValue) {
        props.push({ kind: 'static', name, value: true });
      } else if (bindings.length === 0) {
        props.push({ kind: 'static', name, value: decodeEntities(segments[0]) });
      } else if (bindings.length === 1 && segments[0] === '' && segments[1] === '') {
        props.push({ kind: 'value', name, binding: bindings[0] });
      } else {
        props.push({ kind: 'text', name, segments: segments.map(decodeEntities), bindings });
      }
    }
    return { binding: tag.binding, closeBinding: tag.closeBinding, props, children: childrenPlan(tag) };
  };

  const childrenPlan = (tag: TemplateComponent): ComponentChildrenPlan => {
    if (tag.closeStart === null) return { kind: 'none' };
    const plan = region(tag.startTag.end, tag.closeStart, tag.children);
    const { strings, slots } = plan;
    if (slots.length === 0) {
      const text = strings[0];
      if (isBlank(text)) return { kind: 'none' };
      if (!text.includes('<') && !text.includes('&')) return { kind: 'text', text };
    } else if (slots.length === 1 && isBlank(strings[0]) && isBlank(strings[1])) {
      return { kind: 'slot', slot: slots[0] };
    }
    return { kind: 'template', plan };
  };

  const last = input.length - 1;
  return region({ string: 0, offset: 0 }, { string: last, offset: input[last].length }, parsed.nodes);
};
