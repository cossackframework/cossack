import { forEachHtmlToken, type HtmlAttribute, type HtmlToken } from './template-analysis';

// Void elements in HTML5 that don't need a closing slash.
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

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

// HTML whitespace only: a no-break space (U+00A0) is content.
const collapseWhitespace = (text: string): string => text.replace(/[ \t\n\f\r]+/g, ' ');
const isWhitespace = (text: string): boolean => /^[ \t\n\f\r]*$/.test(text);
const trimWhitespace = (text: string): string => text.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '');

/**
 * Minify rendered HTML for production responses.
 *
 * The markup is read with the renderer's shared tokenizer, so text, attribute
 * values, comments and raw-text elements are told apart exactly as the
 * browser parses them:
 *  - text: whitespace runs collapse to one space; whitespace-only text
 *    between tags is removed (the client treats it as filler). <pre> text is
 *    kept as is.
 *  - <script>, <style>, <textarea> and <title> text is kept as is.
 *  - comments are removed, except conditional comments and hydration markers.
 *  - tags: simple attribute values lose their quotes, `class` whitespace
 *    collapses, default `type` attributes and void-element slashes go away.
 *    Other attribute values are kept byte for byte.
 */
export function minifyHtml(html: string): string {
    let out = '';
    // Text is gathered across removed comments, then written once.
    let text = '';
    let preDepth = 0;

    const flushText = (last = false) => {
        if (!text) return;
        if (preDepth > 0) {
            out += text;
        } else if (!isWhitespace(text)) {
            let collapsed = collapseWhitespace(text);
            // The document itself starts and ends without whitespace.
            if (!out) collapsed = collapsed.replace(/^ /, '');
            if (last) collapsed = collapsed.replace(/ $/, '');
            out += collapsed;
        }
        text = '';
    };

    const attribute = (tag: string, attr: HtmlAttribute, beforeSlash: boolean): string => {
        if (attr.valueStart < 0) return ` ${attr.name}`;
        let value = html.slice(attr.valueStart, attr.valueEnd);
        const name = attr.name.toLowerCase();
        if (name === 'type' && isDefaultType(tag, value)) return '';
        if (name === 'class') value = trimWhitespace(collapseWhitespace(value));
        // An unquoted value would swallow the `/` of a following `/>`.
        if (!beforeSlash && (!attr.quote || UNQUOTED_VALUE.test(value))) return ` ${attr.name}=${value}`;
        if (attr.quote) return ` ${attr.name}=${attr.quote}${value}${attr.quote}`;
        return ` ${attr.name}="${value.replace(/"/g, '&quot;')}"`;
    };

    forEachHtmlToken(html, (token: HtmlToken) => {
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
                // An attribute named `=...` exists only after a `/` or another
                // attribute's value; rewriting the separator could change its
                // meaning, so such malformed tags are copied as written.
                if (!token.closed || token.attributes.some((attr) => attr.name.startsWith('='))) {
                    out += html.slice(token.start, token.end);
                    break;
                }
                const { name, attributes } = token;
                // `/>` matters only on foreign (SVG/MathML) elements.
                const slash = token.selfClosing && !VOID_ELEMENTS.has(name);
                out += html.slice(token.start, token.nameEnd);
                attributes.forEach((attr, index) => {
                    out += attribute(name, attr, slash && index === attributes.length - 1);
                });
                out += slash ? '/>' : '>';
                if (name === 'pre') preDepth++;
                break;
            }
            case 'end-tag':
                flushText();
                out += `${html.slice(token.start, token.nameEnd)}>`;
                if (token.name === 'pre' && preDepth > 0) preDepth--;
                break;
            case 'raw-text':
            case 'other':
                flushText();
                out += html.slice(token.start, token.end);
                break;
        }
    });
    flushText(true);
    return out;
}
