import { describe, expect, it } from 'vitest';
import { parseTemplate, type TemplateNode } from './template-parse';

const strings = (template: TemplateStringsArray, ..._values: unknown[]) => [...template];
const codes = (input: readonly string[], options?: { svg?: boolean }) => parseTemplate(input, options).problems.map((problem) => problem.code);

/** A compact view of the tree: tags, components and binding indices. */
const shape = (nodes: readonly TemplateNode[]): unknown[] => nodes.flatMap((node): unknown[] => {
  switch (node.type) {
    case 'element': return [{ [node.tag]: shape(node.children) }];
    case 'component': return [{ [`$${node.binding}/${node.closeBinding ?? '-'}`]: shape(node.children) }];
    case 'binding': return [node.binding];
    case 'text': return node.text.trim() ? [node.text.trim()] : [];
    default: return [];
  }
});

describe('parseTemplate', () => {
  it('builds elements, text and node bindings', () => {
    const parsed = parseTemplate(strings`<div class="a"><p>${1}</p><br>${2}</div>`);
    expect(shape(parsed.nodes)).toEqual([{ div: [{ p: [0] }, { br: [] }, 1] }]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.bindings.map((role) => role.kind)).toEqual(['node', 'node']);
  });

  it('records attributes with their bindings and static text', () => {
    const parsed = parseTemplate(strings`<a href=${1} class="btn ${2}" data-x='y' hidden .value=${3} @click=${4} ...=${5}></a>`);
    const anchor = parsed.nodes[0];
    if (anchor.type !== 'element') throw new Error('expected an element');
    expect(anchor.attributes.map(({ name, hasValue, segments, bindings }) => ({ name, hasValue, segments, bindings }))).toEqual([
      { name: 'href', hasValue: true, segments: ['', ''], bindings: [0] },
      { name: 'class', hasValue: true, segments: ['btn ', ''], bindings: [1] },
      { name: 'data-x', hasValue: true, segments: ['y'], bindings: [] },
      { name: 'hidden', hasValue: false, segments: [''], bindings: [] },
      { name: '.value', hasValue: true, segments: ['', ''], bindings: [2] },
      { name: '@click', hasValue: true, segments: ['', ''], bindings: [3] },
      { name: '...', hasValue: true, segments: ['', ''], bindings: [4] },
    ]);
    expect(parsed.bindings.every((role) => role.kind === 'attribute')).toBe(true);
  });

  it('reads component tags, their attributes and children', () => {
    const parsed = parseTemplate(strings`<div><${1} hoverable padding="sm" .x=${2}><${3} variant="ghost">Save</${4}></${5}><${6} /></div>`);
    expect(shape(parsed.nodes)).toEqual([{ div: [{ '$0/4': [{ '$2/3': ['Save'] }] }, { '$5/-': [] }] }]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.bindings.map((role) => role.kind)).toEqual(['tag', 'attribute', 'tag', 'tag', 'tag', 'tag']);
    const card = (parsed.nodes[0] as any).children[0];
    expect(card.attributes.map((attribute: any) => attribute.name)).toEqual(['hoverable', 'padding', '.x']);
  });

  it('applies implied end tags and optional end tags', () => {
    const parsed = parseTemplate(strings`<ul><li>a<li>b</ul><p>x<div></div><table><tr><td>1<td>2</table>`);
    expect(parsed.problems).toEqual([]);
    expect(shape(parsed.nodes)).toEqual([
      { ul: [{ li: ['a'] }, { li: ['b'] }] },
      { p: ['x'] },
      { div: [] },
      { table: [{ tr: [{ td: ['1'] }, { td: ['2'] }] }] },
    ]);
  });

  it('allows self-closing tags in SVG only', () => {
    expect(codes(strings`<svg><path d="M0" /><circle r="1"/></svg>`)).toEqual([]);
    expect(codes(strings`<path d="M0" />`, { svg: true })).toEqual([]);
    expect(codes(strings`<div />`)).toEqual(['COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT']);
  });

  it('reports structural problems', () => {
    expect(codes(strings`<div><span></div>`)).toEqual(['COSSACK_TEMPLATE_UNCLOSED_ELEMENT']);
    expect(codes(strings`<div></span></div>`)).toEqual(['COSSACK_TEMPLATE_UNEXPECTED_END_TAG']);
    expect(codes(strings`<div>`)).toEqual(['COSSACK_TEMPLATE_UNCLOSED_ELEMENT']);
    expect(codes(strings`<div class="a`)).toEqual(['COSSACK_TEMPLATE_UNTERMINATED', 'COSSACK_TEMPLATE_UNCLOSED_ELEMENT']);
    expect(codes(strings`<div ${1}></div>`)).toEqual(['COSSACK_TEMPLATE_DROPPED_BINDING']);
    expect(codes(strings`<!-- ${1} -->`)).toEqual(['COSSACK_TEMPLATE_DROPPED_BINDING']);
    expect(codes(strings`<input :value=${1}>`)).toEqual(['COSSACK_TEMPLATE_UNKNOWN_BINDING_PREFIX']);
    expect(codes(strings`<button @click="go()"></button>`)).toEqual(['COSSACK_TEMPLATE_PREFIX_WITHOUT_BINDING']);
    expect(codes(strings`<input .value="a${1}">`)).toEqual(['COSSACK_TEMPLATE_PARTIAL_BINDING']);
    expect(codes(strings`<div class="a" class=${1}></div>`)).toEqual(['COSSACK_TEMPLATE_DUPLICATE_ATTRIBUTE']);
    expect(codes(strings`<${1}>`)).toEqual(['COSSACK_TEMPLATE_UNCLOSED_COMPONENT']);
    expect(codes(strings`<div></${1}></div>`)).toEqual(['COSSACK_TEMPLATE_UNEXPECTED_COMPONENT_END']);
    expect(codes(strings`<${1}><div></${2}>`)).toEqual(['COSSACK_TEMPLATE_UNCLOSED_ELEMENT']);
  });

  it('keeps raw text and comment bindings apart from markup', () => {
    const parsed = parseTemplate(strings`<script>const a = ${1} < 2;</script><textarea>${2}</textarea><!-- <${3}> -->`);
    expect(parsed.bindings.map((role) => role.kind)).toEqual(['raw-text', 'raw-text', 'dropped']);
    expect(shape(parsed.nodes)).toEqual([{ script: ['const a =', 0, '< 2;'] }, { textarea: [1] }]);
  });

  it('records locations as string and offset pairs', () => {
    const parsed = parseTemplate(strings`<p>
  <b title=${1}>x</b></p>`);
    const bold = (parsed.nodes[0] as any).children.find((node: TemplateNode) => node.type === 'element');
    expect(bold.startTag.start).toEqual({ string: 0, offset: 6 });
    expect(bold.attributes[0].nameRange).toEqual({ start: { string: 0, offset: 9 }, end: { string: 0, offset: 14 } });
    expect(bold.range.end).toEqual({ string: 1, offset: 6 });
  });
});
