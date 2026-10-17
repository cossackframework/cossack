/**
 * Rich text: a ProseMirror (TipTap) JSON document, `{ type: 'doc', content }`. The dashboard
 * edits it in the browser, the site renders it to HTML on the server, and the content API
 * returns the JSON for other renderers such as mobile apps. Only the nodes, marks and
 * attributes declared here are accepted; the HTML renderer escapes every text and attribute.
 */

export interface RichTextMark {
    readonly type: string;
    readonly attrs?: { readonly [name: string]: unknown };
}

export interface RichTextNode {
    readonly type: string;
    readonly attrs?: { readonly [name: string]: unknown };
    readonly content?: readonly RichTextNode[];
    readonly text?: string;
    readonly marks?: readonly RichTextMark[];
}

export interface RichTextDoc {
    readonly type: 'doc';
    readonly content: readonly RichTextNode[];
}

/** A block embedded in a document: a top-level `cmsBlock` node's attributes. */
export interface EmbeddedBlock {
    readonly id: string;
    readonly type: string;
    readonly data: { readonly [field: string]: unknown };
}

export const RICH_TEXT_LIMITS = Object.freeze({ bytes: 512 * 1024, nodes: 20_000, depth: 24, text: 100_000 });

/** Node types by where they may appear. `cmsBlock` is allowed only at the top level. */
export const RICH_TEXT_NODES = Object.freeze({
    block: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'image'] as const,
    inline: ['text', 'hardBreak'] as const,
    top: ['cmsBlock'] as const,
});
export const RICH_TEXT_MARKS = Object.freeze(['bold', 'italic', 'underline', 'strike', 'code', 'link'] as const);

const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BLOCK_TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z0-9+#-]{1,40}$/;
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

/** A link target: `http(s)`, `mailto:`, `tel:`, a site path or a fragment. */
export function safeLinkUrl(url: unknown): url is string {
    return typeof url === 'string' && url.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(url)
        && /^(?:https?:\/\/[^/]|mailto:|tel:|\/(?!\/)|#)/i.test(url);
}

/** An image source: a media file of this site or an `https` URL. */
export function safeImageUrl(url: unknown): url is string {
    return typeof url === 'string' && url.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(url) && /^(?:https:\/\/[^/]|\/media\/)/i.test(url);
}

const INVALID = Symbol('invalid');
type AttributeCheck = (value: unknown) => unknown;
const text = (max: number): AttributeCheck => value => typeof value === 'string' && [...value].length <= max ? value : INVALID;
const align: AttributeCheck = value => typeof value === 'string' && ALIGNMENTS.has(value) ? value : INVALID;

/** Attributes each node keeps; others, and null values, are dropped. */
const NODE_ATTRIBUTES: { readonly [type: string]: { readonly [name: string]: AttributeCheck } } = {
    paragraph: { textAlign: align },
    heading: { level: value => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6 ? value : INVALID, textAlign: align },
    orderedList: { start: value => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000 ? value : INVALID },
    codeBlock: { language: value => typeof value === 'string' && LANGUAGE.test(value) ? value : INVALID },
    image: { src: value => safeImageUrl(value) ? value : INVALID, alt: text(500), title: text(300), mediaId: value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : INVALID },
    cmsBlock: {
        id: value => typeof value === 'string' && BLOCK_ID.test(value) ? value : INVALID,
        type: value => typeof value === 'string' && BLOCK_TYPE.test(value) ? value : INVALID,
        data: value => isPlainObject(value) ? value : INVALID,
    },
};
const REQUIRED_ATTRIBUTES: { readonly [type: string]: readonly string[] } = { heading: ['level'], image: ['src'], cmsBlock: ['id', 'type', 'data'] };
const MARK_ATTRIBUTES: { readonly [type: string]: { readonly [name: string]: AttributeCheck } } = {
    link: { href: value => safeLinkUrl(value) ? value : INVALID, target: value => value === '_blank' ? value : INVALID },
};

/** What each node holds. */
const CONTENT: { readonly [type: string]: 'block' | 'inline' | 'text' | 'items' | 'none' } = {
    paragraph: 'inline', heading: 'inline', blockquote: 'block', bulletList: 'items', orderedList: 'items', listItem: 'block',
    codeBlock: 'text', horizontalRule: 'none', image: 'none', hardBreak: 'none', cmsBlock: 'none',
};

type Checked = { doc: RichTextDoc } | { error: string };

/**
 * Validate a document and return a clean copy: known nodes, marks and attributes only, without
 * null attributes. Errors name the path, such as `content[2].marks[0].attrs.href`.
 */
export function checkRichText(value: unknown): Checked {
    if (!isPlainObject(value) || value.type !== 'doc') return { error: 'must be a rich text document.' };
    const size = JSON.stringify(value).length;
    if (size > RICH_TEXT_LIMITS.bytes) return { error: `must be at most ${RICH_TEXT_LIMITS.bytes / 1024} KB.` };
    const state = { nodes: 0 };
    try {
        const content = checkContent(value.content, 'top', 'content', 1, state);
        return { doc: Object.freeze({ type: 'doc', content }) };
    } catch (error) {
        if (error instanceof RichTextError) return { error: error.message };
        throw error;
    }
}

export function richTextProblem(value: unknown): string | undefined {
    const checked = checkRichText(value);
    return 'error' in checked ? checked.error : undefined;
}

/** The validated, cleaned document. Throws on an invalid one. */
export function normalizeRichText(value: unknown): RichTextDoc {
    const checked = checkRichText(value);
    if ('error' in checked) throw new RichTextError(checked.error);
    return checked.doc;
}

class RichTextError extends Error {}

function checkContent(value: unknown, context: 'top' | 'block' | 'inline' | 'text' | 'items' | 'none', path: string, depth: number, state: { nodes: number }): RichTextNode[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new RichTextError(`${path} must be a list of nodes.`);
    if (context === 'none' && value.length) throw new RichTextError(`${path} must be empty.`);
    if (depth > RICH_TEXT_LIMITS.depth) throw new RichTextError(`nests deeper than ${RICH_TEXT_LIMITS.depth} levels.`);
    return value.map((node, index) => checkNode(node, context, `${path}[${index}]`, depth, state));
}

function checkNode(value: unknown, context: 'top' | 'block' | 'inline' | 'text' | 'items' | 'none', path: string, depth: number, state: { nodes: number }): RichTextNode {
    if (++state.nodes > RICH_TEXT_LIMITS.nodes) throw new RichTextError(`must have at most ${RICH_TEXT_LIMITS.nodes} nodes.`);
    if (!isPlainObject(value) || typeof value.type !== 'string') throw new RichTextError(`${path} must be a node.`);
    const type = value.type;
    const allowed = context === 'top' ? [...RICH_TEXT_NODES.block, ...RICH_TEXT_NODES.top]
        : context === 'block' ? RICH_TEXT_NODES.block
        : context === 'inline' ? RICH_TEXT_NODES.inline
        : context === 'text' ? ['text']
        : context === 'items' ? ['listItem'] : [];
    if (!(allowed as readonly string[]).includes(type)) throw new RichTextError(`${path}: ${type} is not allowed here.`);
    if (type === 'text') {
        if (typeof value.text !== 'string' || !value.text || [...value.text].length > RICH_TEXT_LIMITS.text) throw new RichTextError(`${path} must hold 1-${RICH_TEXT_LIMITS.text} characters.`);
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value.text)) throw new RichTextError(`${path} must be well-formed text.`);
        const marks = context === 'text' ? [] : checkMarks(value.marks, `${path}.marks`);
        if (context === 'text' && value.marks !== undefined && (!Array.isArray(value.marks) || value.marks.length)) throw new RichTextError(`${path}: code blocks hold plain text.`);
        return Object.freeze(marks.length ? { type, text: value.text, marks } : { type, text: value.text });
    }
    const attrs = checkAttributes(type, value.attrs, `${path}.attrs`, NODE_ATTRIBUTES[type] ?? {});
    for (const name of REQUIRED_ATTRIBUTES[type] ?? []) if (attrs[name] === undefined) throw new RichTextError(`${path}.attrs.${name} is required.`);
    const content = checkContent(value.content, CONTENT[type] ?? 'none', `${path}.content`, depth + 1, state);
    if ((type === 'bulletList' || type === 'orderedList' || type === 'listItem' || type === 'blockquote') && !content.length) throw new RichTextError(`${path} must not be empty.`);
    return Object.freeze({ type, ...(Object.keys(attrs).length ? { attrs: Object.freeze(attrs) } : {}), ...(content.length ? { content: Object.freeze(content) } : {}) });
}

function checkAttributes(owner: string, value: unknown, path: string, spec: { readonly [name: string]: AttributeCheck }): { [name: string]: unknown } {
    if (value === undefined || value === null) return {};
    if (!isPlainObject(value)) throw new RichTextError(`${path} must be an object.`);
    const attrs: { [name: string]: unknown } = {};
    for (const [name, check] of Object.entries(spec)) {
        const entry = value[name];
        if (entry === undefined || entry === null || entry === '') continue;
        const checked = check(entry);
        if (checked === INVALID) throw new RichTextError(`${path}.${name} is not valid for ${owner}.`);
        attrs[name] = checked;
    }
    return attrs;
}

function checkMarks(value: unknown, path: string): RichTextMark[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > RICH_TEXT_MARKS.length) throw new RichTextError(`${path} must be a list of marks.`);
    const seen = new Set<string>();
    return value.map((mark, index) => {
        if (!isPlainObject(mark) || !(RICH_TEXT_MARKS as readonly string[]).includes(mark.type as string)) throw new RichTextError(`${path}[${index}] is not an allowed mark.`);
        const type = mark.type as string;
        if (seen.has(type)) throw new RichTextError(`${path} repeats ${type}.`);
        seen.add(type);
        const attrs = checkAttributes(type, mark.attrs, `${path}[${index}].attrs`, MARK_ATTRIBUTES[type] ?? {});
        if (type === 'link' && attrs.href === undefined) throw new RichTextError(`${path}[${index}].attrs.href is required.`);
        return Object.freeze(Object.keys(attrs).length ? { type, attrs: Object.freeze(attrs) } : { type });
    });
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** An empty document. */
export function emptyRichText(): RichTextDoc {
    return { type: 'doc', content: [] };
}

/** Plain text as a document: blank lines separate paragraphs, single line breaks stay. */
export function richTextFromPlain(text: string): RichTextDoc {
    const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    return {
        type: 'doc',
        content: paragraphs.map(paragraph => ({
            type: 'paragraph',
            content: paragraph.split('\n').flatMap((line, index): RichTextNode[] => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
        })),
    };
}

/** True when the document has no text, images or blocks. */
export function richTextEmpty(doc: RichTextDoc | null | undefined): boolean {
    return !doc || !richTextPlain(doc).trim() && !doc.content.some(function visual(node): boolean {
        return node.type === 'image' || node.type === 'cmsBlock' || node.type === 'horizontalRule' || (node.content ?? []).some(visual);
    });
}

/** The document's text, with blank lines between blocks, for search and excerpts. */
export function richTextPlain(doc: RichTextDoc | null | undefined, max: number = RICH_TEXT_LIMITS.text): string {
    if (!doc || !Array.isArray(doc.content)) return '';
    const parts: string[] = [];
    let length = 0;
    const inline = (nodes: readonly RichTextNode[] = []) => nodes.map(node => node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : '').join('');
    const visit = (nodes: readonly RichTextNode[]) => {
        for (const node of nodes) {
            if (length >= max) return;
            if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
                const value = inline(node.content).trim();
                if (value) { parts.push(value); length += value.length + 2; }
            } else if (node.type === 'image' && typeof node.attrs?.alt === 'string' && node.attrs.alt) {
                parts.push(node.attrs.alt);
                length += node.attrs.alt.length + 2;
            } else visit(node.content ?? []);
        }
    };
    visit(doc.content);
    const value = parts.join('\n\n');
    return value.length > max ? value.slice(0, max) : value;
}

/** The document's first `words` words, with an ellipsis when cut. */
export function richTextExcerpt(doc: RichTextDoc | null | undefined, words = 55): string {
    const all = richTextPlain(doc, words * 40).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ');
}

/** The blocks a document embeds, in order. */
export function richTextBlocks(doc: RichTextDoc | null | undefined): EmbeddedBlock[] {
    return (doc?.content ?? []).filter(node => node.type === 'cmsBlock' && node.attrs).map(node => ({
        id: node.attrs!.id as string, type: node.attrs!.type as string, data: (node.attrs!.data ?? {}) as EmbeddedBlock['data'],
    }));
}

/** Media file IDs of the document's images. Embedded blocks report their own. */
export function richTextMedia(doc: RichTextDoc | null | undefined): string[] {
    const ids = new Set<string>();
    const visit = (nodes: readonly RichTextNode[]) => {
        for (const node of nodes) {
            if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId);
            visit(node.content ?? []);
        }
    };
    visit(doc?.content ?? []);
    return [...ids];
}

/** Replace the embedded blocks, in order, with checked ones: their data with defaults applied. */
export function withRichTextBlocks(doc: RichTextDoc, blocks: readonly EmbeddedBlock[]): RichTextDoc {
    const byId = new Map(blocks.map(block => [block.id, block]));
    return Object.freeze({
        type: 'doc',
        content: Object.freeze(doc.content.map(node => {
            const block = node.type === 'cmsBlock' ? byId.get(node.attrs?.id as string) : undefined;
            return block ? Object.freeze({ type: 'cmsBlock', attrs: Object.freeze({ id: block.id, type: block.type, data: block.data }) }) : node;
        })),
    });
}

export interface RichTextMediaInfo {
    readonly url: string;
    readonly width?: number | null;
    readonly height?: number | null;
    /** Resized variants, for `srcset`. */
    readonly srcset?: string;
}

export interface RichTextRenderOptions {
    /** Current file details by media ID; null hides an image whose file is gone. Without it, stored sources are used. */
    readonly media?: (id: string) => RichTextMediaInfo | null | undefined;
    /** HTML for an embedded block in `richTextHtml`; omitted when absent. */
    readonly block?: (block: EmbeddedBlock) => string;
}

/** A run of HTML, or an embedded block for the theme to render. */
export type ContentPart = { readonly kind: 'html'; readonly html: string } | { readonly kind: 'block'; readonly block: EmbeddedBlock };

/** The document split at its embedded blocks: HTML runs and blocks, in order. */
export function richTextParts(doc: RichTextDoc | null | undefined, options: RichTextRenderOptions = {}): ContentPart[] {
    const parts: ContentPart[] = [];
    let run = '';
    for (const node of doc?.content ?? []) {
        if (node.type === 'cmsBlock') {
            if (run) parts.push({ kind: 'html', html: run });
            run = '';
            const [block] = richTextBlocks({ type: 'doc', content: [node] });
            if (block) parts.push({ kind: 'block', block });
        } else run += nodeHtml(node, options);
    }
    if (run) parts.push({ kind: 'html', html: run });
    return parts;
}

/** The document as HTML. Text and attributes are escaped; blocks render through `options.block`. */
export function richTextHtml(doc: RichTextDoc | null | undefined, options: RichTextRenderOptions = {}): string {
    return (doc?.content ?? []).map(node => node.type === 'cmsBlock' ? options.block?.(richTextBlocks({ type: 'doc', content: [node] })[0]!) ?? '' : nodeHtml(node, options)).join('');
}

const ESCAPES: { readonly [character: string]: string } = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ESCAPES[character]!);
}

const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'code'];
const MARK_TAGS: { readonly [type: string]: string } = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' };

function nodeHtml(node: RichTextNode, options: RichTextRenderOptions): string {
    const children = () => (node.content ?? []).map(child => nodeHtml(child, options)).join('');
    const alignment = typeof node.attrs?.textAlign === 'string' && ALIGNMENTS.has(node.attrs.textAlign) && node.attrs.textAlign !== 'left' ? ` style="text-align: ${node.attrs.textAlign}"` : '';
    switch (node.type) {
        case 'text': {
            let html = escapeHtml(node.text ?? '');
            const marks = [...(node.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type));
            for (const mark of marks) {
                if (mark.type === 'link') {
                    if (!safeLinkUrl(mark.attrs?.href)) continue;
                    const external = mark.attrs?.target === '_blank';
                    html = `<a href="${escapeHtml(mark.attrs.href as string)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${html}</a>`;
                } else if (MARK_TAGS[mark.type]) html = `<${MARK_TAGS[mark.type]}>${html}</${MARK_TAGS[mark.type]}>`;
            }
            return html;
        }
        case 'hardBreak': return '<br>';
        case 'paragraph': return `<p${alignment}>${children()}</p>`;
        case 'heading': {
            const level = Number.isInteger(node.attrs?.level) ? Math.min(Math.max(node.attrs!.level as number, 1), 6) : 2;
            return `<h${level}${alignment}>${children()}</h${level}>`;
        }
        case 'blockquote': return `<blockquote>${children()}</blockquote>`;
        case 'bulletList': return `<ul>${children()}</ul>`;
        case 'orderedList': {
            const start = Number.isSafeInteger(node.attrs?.start) && node.attrs!.start !== 1 ? ` start="${node.attrs!.start as number}"` : '';
            return `<ol${start}>${children()}</ol>`;
        }
        case 'listItem': return `<li>${children()}</li>`;
        case 'codeBlock': {
            const language = typeof node.attrs?.language === 'string' && LANGUAGE.test(node.attrs.language) ? ` class="language-${node.attrs.language}"` : '';
            return `<pre><code${language}>${(node.content ?? []).map(child => escapeHtml(child.text ?? '')).join('')}</code></pre>`;
        }
        case 'horizontalRule': return '<hr>';
        case 'image': {
            const mediaId = typeof node.attrs?.mediaId === 'string' ? node.attrs.mediaId : null;
            const info = mediaId && options.media ? options.media(mediaId) : undefined;
            if (info === null) return '';
            const src = info?.url ?? node.attrs?.src;
            if (!safeImageUrl(src)) return '';
            const size = info?.width && info.height ? ` width="${info.width}" height="${info.height}"` : '';
            const title = typeof node.attrs?.title === 'string' && node.attrs.title ? ` title="${escapeHtml(node.attrs.title)}"` : '';
            const srcset = info?.srcset ? ` srcset="${escapeHtml(info.srcset)}" sizes="(min-width: 768px) 768px, 100vw"` : '';
            return `<img src="${escapeHtml(src)}"${srcset} alt="${escapeHtml(typeof node.attrs?.alt === 'string' ? node.attrs.alt : '')}"${title}${size} loading="lazy" decoding="async">`;
        }
        default: return '';
    }
}
