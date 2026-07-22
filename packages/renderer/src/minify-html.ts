// Regex to match content inside <script>, <style>, <pre>, and <textarea> tags
// so we can preserve their content as-is during minification.
const PRESERVE_TAGS = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;

// Void elements in HTML5 that don't need a closing slash
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Regex to match void element self-closing tags: <img ... />
const VOID_SELF_CLOSE = new RegExp(
    `<(${[...VOID_ELEMENTS].join('|')})(\\s[^>]*)?\\/\\s*>`,
    'gi'
);

// Regex to match type="text/javascript" or type="text/css" attributes
const TYPE_JS_CSS = /\s+type\s*=\s*["']text\/(javascript|css)["']/gi;

// Regex to match attribute values that are safe to unquote
// (alphanumeric, dash, underscore, dot)
// Only unquote when the closing quote is followed by a valid attribute/tag
// separator. Besides matching the HTML grammar, this prevents malformed
// third-party markup such as `r="6"stroke="currentColor"` from becoming the
// substantially worse `r=6stroke=currentColor` during minification.
const QUOTED_ATTR = /(\w[\w-]*)\s*=\s*["']([a-zA-Z0-9_.-]+)["'](?=\s|\/?>)/g;

function preserveBlocks(html: string): { html: string; blocks: string[] } {
    const blocks: string[] = [];
    const htmlWithPlaceholders = html.replace(PRESERVE_TAGS, (match) => {
        // Strip type="text/javascript" and type="text/css" from the opening tag
        // before preserving, so these unnecessary attributes get removed.
        const cleaned = match.replace(TYPE_JS_CSS, '');
        blocks.push(cleaned);
        return `\x00PRESERVE_${blocks.length - 1}\x00`;
    });
    return { html: htmlWithPlaceholders, blocks };
}

function restoreBlocks(html: string, blocks: string[]): string {
    return html.replace(/\x00PRESERVE_(\d+)\x00/g, (_, index) => {
        return blocks[parseInt(index, 10)];
    });
}

export function minifyHtml(html: string): string {
    // Step 1: Preserve blocks that should not be minified
    // (also strips type=text/javascript and type=text/css from their opening tags)
    const { html: preserved, blocks } = preserveBlocks(html);

    // Step 2: Remove HTML comments — but preserve conditional IE comments
    // (<!--[if ...]>), Cossack hydration markers (<!--CRP_i-->, <!--/CRP-->),
    // and sequence markers (<!--CSA-S-->, <!--CSA-E-->) used to adopt lists.
    let result = preserved.replace(/<!--(?!\[if\s|\/?CRP|CSA-[SE])[\s\S]*?-->/g, '');

    // Step 3: Remove type="text/javascript" and type="text/css" attributes
    // (for any remaining tags not inside preserved blocks)
    result = result.replace(TYPE_JS_CSS, '');

    // Step 4: Collapse runs of whitespace (spaces, tabs, newlines) to a single space
    result = result.replace(/\s+/g, ' ');

    // Step 5: Remove whitespace between tags where there's no text content
    result = result.replace(/>\s+</g, '><');

    // Step 6: Remove optional quotes around simple attribute values
    result = result.replace(QUOTED_ATTR, (_, name, value) => {
        return `${name}=${value}`;
    });

    // Step 7: Collapse /> to > on void elements, trimming trailing space from attrs
    result = result.replace(VOID_SELF_CLOSE, (_, tag, attrs) => {
        const trimmedAttrs = attrs ? attrs.trimEnd() : '';
        return `<${tag}${trimmedAttrs}>`;
    });

    // Step 8: Restore preserved blocks
    result = restoreBlocks(result, blocks);

    // Step 9: Remove whitespace between tags introduced by block restoration
    result = result.replace(/>\s+</g, '><');

    // Step 10: Trim leading/trailing whitespace
    result = result.trim();

    return result;
}
