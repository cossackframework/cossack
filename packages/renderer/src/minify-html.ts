import { forEachHtmlToken, type HtmlAttribute, type HtmlToken } from './template-analysis';

// Void elements in HTML5 that don't need a closing slash.
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Elements the HTML parser keeps in <head>. <template> and <noscript> are
// left out on purpose: their content can end up rendered.
const HEAD_ELEMENTS = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'title']);

// Elements whose content renders with whitespace preserved by default.
const PREFORMATTED = new Set(['pre', 'listing', 'xmp', 'plaintext']);
// Of those, elements the browser reads as raw text: only their end tag ends
// them (<plaintext> never ends).
const RAW_PREFORMATTED = new Set(['xmp', 'plaintext']);

// `white-space` values (and `white-space-collapse` keywords) that keep spaces.
// `pre-line` and `preserve-breaks` keep only line breaks, which collapsing
// a run to "\n" preserves.
const PRESERVING_WHITE_SPACE = new Set(['pre', 'pre-wrap', 'break-spaces', 'preserve', 'preserve-spaces']);
// Tailwind utilities that set such a value.
const PRESERVING_UTILITIES = new Set(['whitespace-pre', 'whitespace-pre-wrap', 'whitespace-break-spaces']);

// Attribute values that are safe without quotes.
const UNQUOTED_VALUE = /^[a-zA-Z0-9_.-]+$/;

// Comments that must survive: IE conditional comments, Cossack hydration
// markers (<!--CRP_i-->, <!--/CRP-->) and list sequence markers
// (<!--CSA-S-->, <!--CSA-E-->). The client skips every other comment.
const KEPT_COMMENT = /^<!--(?:\[if\s|\/?CRP|CSA-[SE])/;

// Removing a comment joins the text around it. That must not turn a `<` into
// a tag or complete a character reference such as `&am` + `p;`.
const joinIsUnsafe = (textBefore: string): boolean => /(?:<|&[a-zA-Z0-9#]*)$/.test(textBefore);

// `type` values that are the default for their element.
const isDefaultType = (tag: string, value: string): boolean => {
    const type = value.toLowerCase();
    return tag === 'script' ? type === 'text/javascript' : (tag === 'style' || tag === 'link') && type === 'text/css';
};

// CSS collapses runs of spaces, tabs and line breaks (not form feeds or
// no-break spaces). A run renders like one space, or like one line break
// when it holds one (that also keeps `pre-line` and CJK line-break rules).
const collapseWhitespace = (text: string): string => {
    let out = '';
    let copied = 0;
    for (let i = 0; i < text.length;) {
        const code = text.charCodeAt(i);
        if (code !== 32 && code !== 9 && code !== 10 && code !== 13) {
            i++;
            continue;
        }
        let end = i;
        let lineBreak = false;
        for (; end < text.length; end++) {
            const next = text.charCodeAt(end);
            if (next === 10 || next === 13) lineBreak = true;
            else if (next !== 32 && next !== 9) break;
        }
        // A lone space or line feed is already collapsed.
        if (end - i > 1 || code === 9 || code === 13) {
            out += text.slice(copied, i) + (lineBreak ? '\n' : ' ');
            copied = end;
        }
        i = end;
    }
    return copied === 0 ? text : out + text.slice(copied);
};
// Whitespace as the HTML parser sees it, outside <body>.
const LEADING_PARSER_WHITESPACE = /^[ \t\n\f\r]+/;

/** True when an element's own attributes make it keep whitespace. */
const preservesWhitespace = (html: string, attributes: readonly HtmlAttribute[]): boolean => {
    for (const attr of attributes) {
        if (attr.valueStart < 0) continue;
        const name = attr.name.toLowerCase();
        if (name !== 'style' && name !== 'class') continue;
        const value = html.slice(attr.valueStart, attr.valueEnd).toLowerCase();
        if (name === 'style') {
            if (!value.includes('white-space')) continue;
            for (const [, declared] of value.matchAll(/(?:^|;)\s*white-space(?:-collapse)?\s*:([^;]*)/g)) {
                if (declared.replace('!important', '').trim().split(/\s+/).some((v) => PRESERVING_WHITE_SPACE.has(v))) return true;
            }
        } else if (value.includes('whitespace-')) {
            // `md:whitespace-pre`, `!whitespace-pre-wrap`, ...
            if (value.split(/[ \t\n\f\r]+/).some((token) => PRESERVING_UTILITIES.has(token.slice(token.lastIndexOf(':') + 1).replace(/^!/, '')))) return true;
        }
    }
    return false;
};

// Where the parser puts what follows. Whitespace is dropped only where the
// parser ignores it or inserts it into <head> or between <head> and <body>,
// where it never renders.
const enum Phase { BeforeHtml, BeforeHead, InHead, AfterHead, Body }

/**
 * Minify a rendered HTML document for production responses without changing
 * how it renders.
 *
 * The markup is read with the renderer's shared tokenizer, so text, attribute
 * values, comments and raw-text elements are told apart exactly as the
 * browser parses them:
 *  - text: each run of whitespace collapses to one space, or to one line
 *    break when it holds one. Whitespace between tags is collapsed, not
 *    removed, so inline elements keep their spacing. It is removed only
 *    before <html>, between <html>, <head> and <body>, and inside <head>.
 *  - <script>, <style>, <textarea> and <title> text is kept as is, and so is
 *    everything inside <pre>, <listing>, <xmp>, <plaintext> and elements
 *    whose `style` or Tailwind class preserves whitespace. Whitespace kept by
 *    a stylesheet cannot be seen here; mark such elements with one of those.
 *  - comments are removed, except conditional comments and hydration markers.
 *  - tags: simple attribute values lose their quotes, `class` whitespace
 *    collapses, default `type` attributes and void-element slashes go away.
 *    Other attribute values are kept byte for byte.
 */
export function minifyHtml(html: string): string {
    let out = '';
    // Text is gathered across removed comments, then written once.
    let text = '';
    let phase = Phase.BeforeHtml;
    // Inside a whitespace-preserving element, everything is copied as is.
    let verbatim: { name: string; depth: number; raw: boolean } | null = null;

    const flushText = () => {
        if (!text) return;
        if (phase !== Phase.Body) {
            // The parser ignores leading whitespace here or puts it in <head>
            // (or between <head> and <body>); other text starts the body.
            text = text.replace(LEADING_PARSER_WHITESPACE, '');
            if (text) phase = Phase.Body;
        }
        out += collapseWhitespace(text);
        text = '';
    };

    const startTagPhase = (name: string) => {
        switch (phase) {
            case Phase.BeforeHtml:
            case Phase.BeforeHead:
                if (name === 'html') phase = Phase.BeforeHead;
                else phase = name === 'head' || HEAD_ELEMENTS.has(name) ? Phase.InHead : Phase.Body;
                break;
            case Phase.InHead:
            case Phase.AfterHead:
                if (name !== 'html' && name !== 'head' && !HEAD_ELEMENTS.has(name)) phase = Phase.Body;
                break;
        }
    };

    const attribute = (tag: string, attr: HtmlAttribute, beforeSlash: boolean): string => {
        if (attr.valueStart < 0) return ` ${attr.name}`;
        let value = html.slice(attr.valueStart, attr.valueEnd);
        const name = attr.name.toLowerCase();
        if (name === 'type' && isDefaultType(tag, value)) return '';
        // Class tokens are separated by ASCII whitespace only.
        if (name === 'class') value = value.replace(/[ \t\n\f\r]+/g, ' ').replace(/^ | $/g, '');
        // An unquoted value would swallow the `/` of a following `/>`.
        if (!beforeSlash && (!attr.quote || UNQUOTED_VALUE.test(value))) return ` ${attr.name}=${value}`;
        if (attr.quote) return ` ${attr.name}=${attr.quote}${value}${attr.quote}`;
        return ` ${attr.name}="${value.replace(/"/g, '&quot;')}"`;
    };

    const startTag = (token: Extract<HtmlToken, { type: 'start-tag' }>): string => {
        // An attribute named `=...` exists only after a `/` or another
        // attribute's value; rewriting the separator could change its
        // meaning, so such malformed tags are copied as written.
        if (!token.closed || token.attributes.some((attr) => attr.name.startsWith('='))) {
            return html.slice(token.start, token.end);
        }
        const { name, attributes } = token;
        // `/>` matters only on foreign (SVG/MathML) elements.
        const slash = token.selfClosing && !VOID_ELEMENTS.has(name);
        let tag = html.slice(token.start, token.nameEnd);
        attributes.forEach((attr, index) => {
            tag += attribute(name, attr, slash && index === attributes.length - 1);
        });
        return tag + (slash ? '/>' : '>');
    };

    forEachHtmlToken(html, (token: HtmlToken) => {
        if (verbatim) {
            out += html.slice(token.start, token.end);
            if (token.type === 'end-tag' && token.name === verbatim.name && verbatim.name !== 'plaintext') {
                if (verbatim.raw || --verbatim.depth === 0) verbatim = null;
            } else if (token.type === 'start-tag' && token.name === verbatim.name && !verbatim.raw) {
                verbatim.depth++;
            }
            return;
        }
        switch (token.type) {
            case 'text':
                text += html.slice(token.start, token.end);
                break;
            case 'comment':
                if (KEPT_COMMENT.test(html.slice(token.start, token.end)) || joinIsUnsafe(text)) {
                    flushText();
                    out += html.slice(token.start, token.end);
                }
                break;
            case 'start-tag': {
                flushText();
                startTagPhase(token.name);
                out += startTag(token);
                const { name } = token;
                if (!VOID_ELEMENTS.has(name) && (PREFORMATTED.has(name) || preservesWhitespace(html, token.attributes))) {
                    verbatim = { name, depth: 1, raw: RAW_PREFORMATTED.has(name) };
                }
                break;
            }
            case 'end-tag':
                flushText();
                // `</title>`, `</script>`... stay in <head>; any other end tag
                // outside the body is treated as starting it.
                if (phase === Phase.InHead && token.name === 'head') phase = Phase.AfterHead;
                else if (phase !== Phase.Body && !HEAD_ELEMENTS.has(token.name)) phase = Phase.Body;
                out += `${html.slice(token.start, token.nameEnd)}>`;
                break;
            case 'raw-text':
            case 'other':
                flushText();
                out += html.slice(token.start, token.end);
                break;
        }
    });
    flushText();
    return out;
}
