import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { minifyHtml } from './minify-html';

// Property test: minified markup parses (with parse5, a spec-compliant
// parser) to the same document, apart from what minification may drop on
// purpose: whitespace in text, comments that are not hydration markers,
// class whitespace and default `type` attributes. It must also render the
// same text: the body's text, with whitespace collapsed the way CSS does
// outside elements that preserve it, is identical.

const PIECES = [
  '<div', '<span', '<p', '<pre', '<b', '<svg', '<path', '<img', '<br', ' ', '  ', '\n', '\t', '\u00a0',
  'class=', 'class="a  b"', 'title="x  y"', 'id=a', ' id=a', ' href=/x', ` v=a"b'c`, "data-x='1 < 2'", ' value="1  2"', 'href=', 'CLASS=', 'type="text/css"', 'x="y"',
  '"', "'", '`', '=', '>', '/>', '/', ' />', '<', 'a < b', 'text', '&amp;', '&am', 'p;', '&#3', '9;',
  '</div>', '</span>', '</p>', '</pre>', '</b>', '</svg>', '<a href=/x/>', '<template>', '</template>', '<li>', '<td>',
  '<!--', '-->', '<!-- c -->', '<!-->', '<!---->', '<!--CRP_0-->', '<!--/CRP-->', '<!--CSA-S-->', '<!doctype html>', '<?x ?>', '</ x>',
  '<script>', '</script>', '<style>', '</style>', '<textarea>', '</textarea>', '<title>', '<TITLE>', '</title>',
  '<html>', '<head>', '</head>', '<body>', '</body>', '<meta charset=x>', '<i>', '</i>', ' text ', ' \n ',
  '<span class="whitespace-pre">', '<div style="white-space:pre-wrap">', '<p style="white-space: pre-line">', '<listing>', '</listing>', '<xmp>', '</xmp>',
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

// Elements that keep whitespace: by default, or by `style`/Tailwind class.
const PRESERVING = new Set(['pre', 'listing', 'xmp', 'plaintext', 'textarea']);
const preserves = (element: Tree.Element): boolean => PRESERVING.has(element.tagName) || element.attrs.some((a) =>
  (a.name === 'style' && /white-space(?:-collapse)?\s*:\s*(?:pre|pre-wrap|break-spaces|preserve)\s*(?:;|!|$)/i.test(a.value)) ||
  (a.name === 'class' && /(?:^|[\s:!])whitespace-(?:pre|pre-wrap|break-spaces)(?:\s|$)/.test(a.value)));
// Elements whose text never renders.
const HIDDEN = new Set(['head', 'script', 'style', 'title', 'template', 'noscript', 'iframe', 'noembed', 'noframes']);

/** The body's text as CSS renders it: preserved text as is, other whitespace runs collapsed. */
const renderedText = (html: string): string[] => {
  const root = parse(html).childNodes.find((node): node is Tree.Element => node.nodeName === 'html')!;
  const body = root.childNodes.find((node): node is Tree.Element => node.nodeName === 'body');
  // Collapsed text runs alternate with preserved text, which stays separate.
  const parts: string[] = [];
  let flowing = '';
  const flush = () => {
    // A run renders as one space, or one line break when it holds one.
    parts.push(flowing.replace(/[ \t\n\r]+/g, (run) => (/[\n\r]/.test(run) ? '\n' : ' ')));
    flowing = '';
  };
  const walk = (element: Tree.Element, preserved: boolean) => {
    for (const node of element.childNodes) {
      if (node.nodeName === '#text') {
        const value = (node as Tree.TextNode).value;
        if (preserved) {
          flush();
          parts.push(value);
        } else {
          flowing += value;
        }
      } else if ('tagName' in node && !HIDDEN.has(node.tagName)) {
        walk(node, preserved || preserves(node));
      }
    }
  };
  if (body) walk(body, false);
  flush();
  return parts;
};

describe('minifyHtml against a spec-compliant parser', () => {
  it('keeps the parsed document and its rendered text for random markup, and is idempotent', () => {
    let seed = 20261014;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let run = 0; run < 4000; run++) {
      let html = '';
      for (let k = 1 + random(14); k > 0; k--) html += PIECES[random(PIECES.length)];
      const minified = minifyHtml(html);
      expect({ html, shape: documentShape(minified) }).toEqual({ html, shape: documentShape(html) });
      expect({ html, text: renderedText(minified) }).toEqual({ html, text: renderedText(html) });
      expect(minifyHtml(minified)).toBe(minified);
    }
  });
});
