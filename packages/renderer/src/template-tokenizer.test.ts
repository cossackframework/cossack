import { describe, it, expect } from 'vitest';
import { parseFragment } from 'parse5';
import { html, render, renderToString, hydrate, nothing } from './cossack-html';
import { analyzeTemplate } from './template-analysis';

const ssrContainer = (result: ReturnType<typeof html>) => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(result, { hydrate: true });
  return container;
};

describe('`<` in text content', () => {
  const tpl = (v: string) => html`<p>if a < b then c=${v}</p>`;

  it('keeps a binding after `a < b` in node position on SSR', () => {
    expect(renderToString(tpl('VAL'))).toBe('<p>if a < b then c=VAL</p>');
    expect(renderToString(tpl('VAL'), { hydrate: true })).toBe('<p>if a < b then c=<!--CRP_0-->VAL<!--/CRP--></p>');
  });

  it('keeps a binding after `a < b` in node position on the client', () => {
    const container = document.createElement('div');
    render(tpl('VAL'), container);
    expect(container.querySelector('p')!.textContent).toBe('if a < b then c=VAL');
    render(tpl('NEXT'), container);
    expect(container.querySelector('p')!.textContent).toBe('if a < b then c=NEXT');
  });

  it('hydrates and updates the binding', () => {
    const container = ssrContainer(tpl('VAL'));
    const p = container.querySelector('p');
    hydrate(tpl('VAL'), container);
    expect(container.querySelector('p')).toBe(p);
    render(tpl('NEXT'), container);
    expect(p!.textContent).toBe('if a < b then c=NEXT');
  });

  it('still treats `<tag` as a tag', () => {
    expect(renderToString(html`<p>1 < 2</p><a href=${'/x'}>x</a>`)).toBe('<p>1 < 2</p><a href="/x">x</a>');
  });
});

describe('bindings inside HTML comments', () => {
  const tpl = (note: string, v: string) => html`<div><!-- note: ${note} --><span>${v}</span></div>`;

  it('never emits hydration markers inside a comment', () => {
    const out = renderToString(tpl('x', 'y'), { hydrate: true });
    expect(out).toBe('<div><!-- note:  --><span><!--CRP_1-->y<!--/CRP--></span></div>');
    const container = document.createElement('div');
    container.innerHTML = out;
    const div = container.querySelector('div')!;
    // The comment stays one comment; nothing leaks out as text.
    expect(div.childNodes.length).toBe(2);
    expect(div.firstChild!.nodeType).toBe(Node.COMMENT_NODE);
    expect(div.textContent).toBe('y');
  });

  it('drops comment bindings on the client too and keeps later bindings working', () => {
    const container = document.createElement('div');
    render(tpl('x', 'y'), container);
    const div = container.querySelector('div')!;
    expect(div.firstChild!.nodeType).toBe(Node.COMMENT_NODE);
    expect((div.firstChild as Comment).data).toBe(' note:  ');
    expect(div.textContent).toBe('y');
    render(tpl('z', 'w'), container);
    expect(div.textContent).toBe('w');
  });

  it('hydrates around a comment binding', () => {
    const container = ssrContainer(tpl('x', 'y'));
    const span = container.querySelector('span');
    hydrate(tpl('x', 'y'), container);
    expect(container.querySelector('span')).toBe(span);
    render(tpl('x', 'q'), container);
    expect(span!.textContent).toBe('q');
  });

  it('handles empty comments and doctype-like markup', () => {
    expect(renderToString(html`<!----><p class=${'a'}>${'b'}</p>`)).toBe('<!----><p class="a">b</p>');
    expect(renderToString(html`<!--><p class=${'a'}>${'b'}</p>`)).toBe('<!--><p class="a">b</p>');
  });
});

describe('bindings inside raw-text elements', () => {
  it('textarea: SSR emits escaped text without markers', () => {
    const out = renderToString(html`<textarea>${'a <b> & c'}</textarea>`, { hydrate: true });
    expect(out).toBe('<textarea>a &lt;b&gt; &amp; c</textarea>');
  });

  it('textarea: preserves a leading newline through standards-based parsing', () => {
    // happy-dom does not drop the first LF of a <textarea>; parse5 does.
    const parsed = parseFragment(renderToString(html`<textarea>${'\nfirst'}</textarea>`, { hydrate: true }));
    const textarea = parsed.childNodes[0];
    expect('childNodes' in textarea && textarea.childNodes[0]).toMatchObject({ value: '\nfirst' });
  });

  it('textarea: client renders and updates the value', () => {
    const tpl = (v: string) => html`<textarea>${v}</textarea>`;
    const container = document.createElement('div');
    render(tpl('one'), container);
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe('one');
    expect(textarea.textContent).toBe('one');
    render(tpl('two'), container);
    expect(textarea.textContent).toBe('two');
  });

  it('title: SSR and client agree, including several bindings', () => {
    const tpl = (a: string, b: string) => html`<title>${a} - ${b}</title>`;
    expect(renderToString(tpl('A&B', 'Site'), { hydrate: true })).toBe('<title>A&amp;B - Site</title>');
    const container = document.createElement('div');
    render(tpl('A&B', 'Site'), container);
    expect(container.querySelector('title')!.textContent).toBe('A&B - Site');
    render(tpl('Next', 'Site'), container);
    expect(container.querySelector('title')!.textContent).toBe('Next - Site');
  });

  it('script: neutralises </script and <!-- in JSON payloads', () => {
    const payload = { html: '</script><script>alert(1)</script>', note: '<!-- x' };
    const out = renderToString(html`<script type="application/json">${JSON.stringify(payload)}</script>`, { hydrate: true });
    expect(out).not.toContain('CRP');
    expect(out.toLowerCase().indexOf('</script')).toBe(out.length - '</script>'.length);
    const container = document.createElement('div');
    container.innerHTML = out;
    const scripts = container.querySelectorAll('script');
    expect(scripts.length).toBe(1);
    expect(JSON.parse(scripts[0].textContent!)).toEqual(payload);
  });

  it('script: client sets the same text as SSR', () => {
    const json = JSON.stringify({ a: '</script>' });
    const tpl = (v: string) => html`<script type="application/json">${v}</script>`;
    const ssr = ssrContainer(tpl(json));
    const container = document.createElement('div');
    render(tpl(json), container);
    expect(container.querySelector('script')!.textContent).toBe(ssr.querySelector('script')!.textContent);
    expect(JSON.parse(container.querySelector('script')!.textContent!)).toEqual({ a: '</script>' });
  });

  it('style: neutralises </style and keeps CSS unescaped', () => {
    const out = renderToString(html`<style>.a > .b { content: "${'</style><b>x</b>'}"; }</style>`, { hydrate: true });
    expect(out).toBe('<style>.a > .b { content: "<\\/style><b>x</b>"; }</style>');
    const container = document.createElement('div');
    container.innerHTML = out;
    expect(container.querySelectorAll('b').length).toBe(0);
  });

  it('hydrates raw-text bindings in place and keeps them bound', () => {
    const tpl = (title: string, body: string) => html`<div><title>${title}</title><textarea>${body}</textarea><p>${'after'}</p></div>`;
    const container = ssrContainer(tpl('T', 'B'));
    const textarea = container.querySelector('textarea');
    const title = container.querySelector('title');
    hydrate(tpl('T', 'B'), container);
    expect(container.querySelector('textarea')).toBe(textarea);
    expect(container.querySelector('title')).toBe(title);
    expect(title!.textContent).toBe('T');
    render(tpl('T2', 'B2'), container);
    expect(title!.textContent).toBe('T2');
    expect(textarea!.textContent).toBe('B2');
    expect(container.querySelector('p')!.textContent).toBe('after');
  });

  it('renders nullish values as empty text', () => {
    expect(renderToString(html`<title>${null}${undefined}${nothing}${false}</title>`)).toBe('<title></title>');
    const container = document.createElement('div');
    render(html`<title>${null}${undefined}${nothing}${false}</title>`, container);
    expect(container.querySelector('title')!.textContent).toBe('');
  });
});

describe('analyzeTemplate', () => {
  const kinds = (strings: TemplateStringsArray, ..._values: unknown[]) =>
    analyzeTemplate(strings).bindings.map((b) => b.kind === 'attribute' ? `attr:${b.name}:${b.start ? 'start' : 'mid'}` : b.kind === 'raw-text' ? `raw:${b.tag}` : b.kind);

  it('classifies bindings like the HTML tokenizer', () => {
    expect(kinds`<p>${1}</p>`).toEqual(['node']);
    expect(kinds`<p>a < b ${1}</p>`).toEqual(['node']);
    expect(kinds`<p>a <b x=${1}></b></p>`).toEqual(['attr:x:start']);
    expect(kinds`<div class="a ${1} b ${2}" .innerHTML=${3} @myEvent=${4}></div>`)
      .toEqual(['attr:class:mid', 'attr:class:mid', 'attr:.innerHTML:start', 'attr:@myEvent:start']);
    expect(kinds`<div title="${1}${2}" x-on:click.prevent="${3}"></div>`)
      .toEqual(['attr:title:start', 'attr:title:mid', 'attr:x-on:click.prevent:start']);
    expect(kinds`<!-- ${1} --><p>${2}</p><!doctype ${3}>`).toEqual(['comment', 'node', 'comment']);
    expect(kinds`<script>${1}</script><style>${2}</style><TEXTAREA>${3}</TEXTAREA><title>${4}</title>${5}`)
      .toEqual(['raw:script', 'raw:style', 'raw:textarea', 'raw:title', 'node']);
    expect(kinds`<script>if (a<b) x = "</scrip"; ${1}</script>${2}`).toEqual(['raw:script', 'node']);
    expect(kinds`<div ${1}></div>`).toEqual(['element']);
    expect(kinds`<a title='${1}' href=${2}>`).toEqual(['attr:title:start', 'attr:href:start']);
  });

  it('records attribute groups for nothing removal', () => {
    const { attributeGroups } = analyzeTemplate(['<div  class="a ', ' b ', '" id=', '>'] as unknown as TemplateStringsArray);
    expect(attributeGroups[0]).toEqual({ indices: [0, 1], prefix: '  class="a ', suffixLength: 1 });
    expect(attributeGroups[2]).toEqual({ indices: [2], prefix: ' id=', suffixLength: 0 });
  });

  it('inserts the scope attribute only into static opening tags', () => {
    const { strings } = analyzeTemplate(['<div class="x"><!-- <b> --><style>p<b {}</style><br/>', '<i>'] as unknown as TemplateStringsArray, 's1');
    expect(strings).toEqual([
      '<div data-cossack-scope="s1" class="x"><!-- <b> --><style data-cossack-scope="s1">p<b {}</style><br data-cossack-scope="s1"/>',
      '<i data-cossack-scope="s1">',
    ]);
  });
});
