import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { minifyHtml } from './minify-html';

// Property test: minified markup parses (with parse5, a spec-compliant
// parser) to the same document, apart from what minification may drop on
// purpose: whitespace in text, comments that are not hydration markers,
// class whitespace and default `type` attributes.

const PIECES = [
  '<div', '<span', '<p', '<pre', '<b', '<svg', '<path', '<img', '<br', ' ', '  ', '\n', '\t', '\u00a0',
  'class=', 'class="a  b"', 'title="x  y"', 'id=a', ' id=a', ' href=/x', ` v=a"b'c`, "data-x='1 < 2'", ' value="1  2"', 'href=', 'CLASS=', 'type="text/css"', 'x="y"',
  '"', "'", '`', '=', '>', '/>', '/', ' />', '<', 'a < b', 'text', '&amp;', '&am', 'p;', '&#3', '9;',
  '</div>', '</span>', '</p>', '</pre>', '</b>', '</svg>', '<a href=/x/>', '<template>', '</template>', '<li>', '<td>',
  '<!--', '-->', '<!-- c -->', '<!-->', '<!---->', '<!--CRP_0-->', '<!--/CRP-->', '<!--CSA-S-->', '<!doctype html>', '<?x ?>', '</ x>',
  '<script>', '</script>', '<style>', '</style>', '<textarea>', '</textarea>', '<title>', '<TITLE>', '</title>',
];

const KEPT_COMMENT = /^(?:\[if\s|\/?CRP|CSA-[SE])/;
const WHITESPACE = /[ \t\n\f\r]+/g;
const VERBATIM = new Set(['script', 'style', 'textarea', 'title', 'pre']);

type Shape = string | { tag: string; ns: string; attrs: string[][]; children: Shape[] };

const textShape = (value: string, verbatim: boolean): Shape | null => {
  if (verbatim) return value;
  const compact = value.replace(WHITESPACE, '');
  return compact ? compact : null;
};

const elementShape = (element: Tree.Element, verbatim: boolean): Shape => {
  const inside = verbatim || VERBATIM.has(element.tagName);
  const nodes: Tree.ChildNode[] = (element as Tree.Template).content?.childNodes ?? element.childNodes;
  const children: Shape[] = [];
  // Removing a comment joins the text around it, so compare joined text.
  let text: string | null = null;
  const flush = () => {
    const shape = text === null ? null : textShape(text, inside);
    if (shape !== null) children.push(shape);
    text = null;
  };
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      text = (text ?? '') + (node as Tree.TextNode).value;
    } else if (node.nodeName === '#comment') {
      const data = (node as Tree.CommentNode).data;
      if (KEPT_COMMENT.test(data)) {
        flush();
        children.push(`<!--${data}-->`);
      }
    } else if ('tagName' in node) {
      flush();
      children.push(elementShape(node, inside));
    }
  }
  flush();
  const attrs = element.attrs
    .filter((a) => !(a.name === 'type' && /^text\/(?:javascript|css)$/i.test(a.value) && ['script', 'style', 'link'].includes(element.tagName)))
    .map((a) => [a.name, a.name === 'class' ? a.value.replace(WHITESPACE, ' ').trim() : a.value]);
  return { tag: element.tagName, ns: element.namespaceURI, attrs, children };
};

const documentShape = (html: string): Shape =>
  elementShape(parse(html).childNodes.find((node): node is Tree.Element => node.nodeName === 'html')!, false);

describe('minifyHtml against a spec-compliant parser', () => {
  it('keeps the parsed document for random markup, and is idempotent', () => {
    let seed = 20261014;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let run = 0; run < 3000; run++) {
      let html = '';
      for (let k = 1 + random(14); k > 0; k--) html += PIECES[random(PIECES.length)];
      const minified = minifyHtml(html);
      expect({ html, shape: documentShape(minified) }).toEqual({ html, shape: documentShape(html) });
      expect(minifyHtml(minified)).toBe(minified);
    }
  });
});
