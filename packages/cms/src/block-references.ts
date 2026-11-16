/**
 * Block references: blocks written inside text, as shortcodes are in WordPress. Markdown
 * fields, widget text and theme options can hold them:
 *
 *   {{ block core/button label="Buy {{ $.title }}" url="/cart" /}}   a block without a body
 *   {{ block core/button }}Price is {{ $.price }}{{ /block }}        a body fills the type's `body` field
 *   {{ block core/group }} …blocks and text… {{ /block }}            a container's body is its children
 *   {{ pattern hero /}}                                              a synced pattern by slug
 *   \{{ … }}                                                         written as is
 *
 * Only block types that declare `inline: true` can be referenced. The parser turns text into
 * text runs and the same `Block` tree the editor stores, so validation and rendering are the
 * blocks' own. Bindings (`{{ $.price }}`) are left in the text, in bodies and in quoted
 * values alike, and resolve when the blocks render. Client-safe.
 */
import { BLOCK_LIMITS } from './block-shape';
import type { Block, BlockDeclaration } from './blocks';

/** A piece of text with references: a run of text, or a block. */
export type TextPart = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'block'; readonly block: Block };

export interface ParsedText {
    readonly parts: readonly TextPart[];
    /** Why parts of the text are not blocks, in order; empty when it is fine. Faulty references are left out of `parts`. */
    readonly problems: readonly string[];
}

/** Whether a text holds a block or pattern reference, so a renderer knows to parse it. */
export function hasBlockReference(value: unknown): value is string {
    return typeof value === 'string' && /(?<!\\)\{\{\s*(?:block|pattern|\/block)\b/.test(value);
}

/** The pattern a `{{ pattern … }}` names, kept as a `core/pattern` block whose `pattern` is the slug until the site resolves it. */
export const PATTERN_REFERENCE = 'core/pattern';

type Tag =
    | { kind: 'open'; type: string; attrs: Record<string, unknown>; closed: boolean }
    | { kind: 'close'; type: string | null }
    | { kind: 'pattern'; ref: string };

interface Frame { type: string; attrs: Record<string, unknown>; parts: TextPart[] }

const NAME = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const ATTRIBUTE = /^[A-Za-z_][\w-]*$/;

/**
 * Parse text into runs and blocks. `types` are the available block types; `prefix` makes the
 * blocks' IDs, which follow their position, distinct in the tree around the text.
 */
export function parseBlockText(text: string, types: ReadonlyMap<string, BlockDeclaration>, prefix = 'ref'): ParsedText {
    const problems: string[] = [];
    const root: Frame = { type: '', attrs: {}, parts: [] };
    const stack: Frame[] = [root];
    let count = 0;
    let buffer = '';
    const flush = () => {
        if (buffer) stack[stack.length - 1]!.parts.push({ kind: 'text', text: buffer });
        buffer = '';
    };
    let at = 0;
    while (at < text.length) {
        // `\{{` writes the braces as text.
        if (text.startsWith('\\{{', at)) { buffer += '{{'; at += 3; continue; }
        if (!text.startsWith('{{', at)) { buffer += text[at]; at++; continue; }
        const end = tagEnd(text, at + 2);
        const inner = end === -1 ? null : text.slice(at + 2, end).trim();
        const tag = inner === null ? null : parseTag(inner);
        // Bindings and anything that is not a reference stay in the text as written.
        if (!tag || typeof tag === 'string') {
            if (typeof tag === 'string') problems.push(tag);
            const stop = end === -1 ? text.length : end + 2;
            if (typeof tag !== 'string') buffer += text.slice(at, stop);
            at = stop;
            continue;
        }
        at = end + 2;
        flush();
        if (tag.kind === 'close') {
            const frame = stack.length > 1 ? stack[stack.length - 1]! : null;
            if (!frame) { problems.push('{{ /block }} closes no block.'); continue; }
            if (tag.type && tag.type !== frame.type) { problems.push(`{{ /block ${tag.type} }} closes ${frame.type}.`); continue; }
            stack.pop();
            const block = build(frame, types, `${prefix}${++count}`, problems, stack.length);
            if (block) stack[stack.length - 1]!.parts.push({ kind: 'block', block });
            continue;
        }
        if (tag.kind === 'pattern') {
            stack[stack.length - 1]!.parts.push({ kind: 'block', block: { _id: `${prefix}${++count}`, type: PATTERN_REFERENCE, data: { pattern: tag.ref } } });
            continue;
        }
        const frame: Frame = { type: tag.type, attrs: tag.attrs, parts: [] };
        if (tag.closed) {
            const block = build(frame, types, `${prefix}${++count}`, problems, stack.length);
            if (block) stack[stack.length - 1]!.parts.push({ kind: 'block', block });
        } else stack.push(frame);
    }
    flush();
    // Blocks left open: their text keeps showing, and the reference is reported.
    while (stack.length > 1) {
        const frame = stack.pop()!;
        problems.push(`{{ block ${frame.type} }} is not closed: end it with {{ /block }}, or write {{ block ${frame.type} … /}} for one without a body.`);
        stack[stack.length - 1]!.parts.push(...frame.parts);
    }
    if (count > BLOCK_LIMITS.count) problems.push(`Text holds at most ${BLOCK_LIMITS.count} block references.`);
    return { parts: merge(root.parts), problems };
}

/** Where the tag starting at `from` ends (the index of its `}}`), skipping quoted values, which may hold `{{ $.price }}`. -1 when it does not end. */
function tagEnd(text: string, from: number): number {
    let quoted = false;
    let depth = 0;
    for (let index = from; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '\\') { index++; continue; }
            if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (text.startsWith('{{', index)) { depth++; index++; continue; }
        if (text.startsWith('}}', index)) {
            if (depth === 0) return index;
            depth--; index++;
        }
    }
    return -1;
}

/** A reference tag, a problem to report (for a reference that is wrong), or null for text such as a binding. */
function parseTag(inner: string): Tag | string | null {
    const closed = inner.endsWith('/');
    const body = closed ? inner.slice(0, -1).trim() : inner;
    const match = /^(\/?block|pattern)\b\s*([\s\S]*)$/.exec(body);
    if (!match) return null;
    const [, keyword, rest] = match as unknown as [string, string, string];
    if (keyword === '/block') {
        const type = rest.trim();
        if (type && !NAME.test(type)) return `{{ /block ${type} }} names no block type.`;
        return { kind: 'close', type: type || null };
    }
    const tokens = attributeTokens(rest);
    if (typeof tokens === 'string') return tokens;
    const [first, ...others] = tokens;
    if (keyword === 'pattern') {
        if (!first || first.value !== undefined || others.length) return '{{ pattern … /}} names one pattern by its slug.';
        return { kind: 'pattern', ref: first.name };
    }
    if (!first || first.value !== undefined || !NAME.test(first.name)) return `{{ block ${rest.trim()} }} names no block type, such as core/button.`;
    const attrs: Record<string, unknown> = {};
    for (const token of others) {
        if (!ATTRIBUTE.test(token.name)) return `${token.name} is not an attribute name.`;
        attrs[token.name] = token.value === undefined ? true : token.value;
    }
    return { kind: 'open', type: first.name, attrs, closed };
}

/** `name`, `name="text"`, `name=12`, `name=true`: the words of a tag after its keyword. */
function attributeTokens(source: string): { name: string; value?: unknown }[] | string {
    const tokens: { name: string; value?: unknown }[] = [];
    let at = 0;
    const space = () => { while (at < source.length && /\s/.test(source[at]!)) at++; };
    while (true) {
        space();
        if (at >= source.length) return tokens;
        const start = at;
        while (at < source.length && !/[\s=]/.test(source[at]!)) at++;
        const name = source.slice(start, at);
        if (source[at] !== '=') { tokens.push({ name }); continue; }
        at++;
        if (source[at] === '"') {
            at++;
            let value = '';
            while (at < source.length && source[at] !== '"') {
                if (source[at] === '\\' && at + 1 < source.length) { value += source[at + 1]; at += 2; continue; }
                value += source[at]; at++;
            }
            if (at >= source.length) return `The value of ${name} is missing its closing quote.`;
            at++;
            tokens.push({ name, value });
            continue;
        }
        const startValue = at;
        while (at < source.length && !/\s/.test(source[at]!)) at++;
        const raw = source.slice(startValue, at);
        if (raw === 'true' || raw === 'false') tokens.push({ name, value: raw === 'true' });
        else if (/^-?\d+(?:\.\d+)?$/.test(raw)) tokens.push({ name, value: Number(raw) });
        else return `The value of ${name} needs quotes: ${name}="${raw}". Bindings go inside them: ${name}="{{ $.field }}".`;
    }
}

/** The block a finished reference stands for, or null after reporting why it cannot be one. */
function build(frame: Frame, types: ReadonlyMap<string, BlockDeclaration>, id: string, problems: string[], depth: number): Block | null {
    const type = types.get(frame.type);
    if (!type) { problems.push(`${frame.type} is not an available block.`); return null; }
    if (type.inline !== true) { problems.push(`${type.label} (${frame.type}) cannot be used in text.`); return null; }
    if (depth > BLOCK_LIMITS.depth) { problems.push(`Block references nest at most ${BLOCK_LIMITS.depth} levels.`); return null; }
    const data: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(frame.attrs)) {
        if (!type.fields[name]) { problems.push(`${frame.type} has no ${name}.`); continue; }
        data[name] = value;
    }
    const parts = merge(frame.parts);
    const hasBody = parts.some(part => part.kind === 'block' || part.text.trim() !== '');
    if (!hasBody) return { _id: id, type: frame.type, data };
    if (type.children) {
        // A container's body is its children; loose text becomes paragraphs, where they may go.
        const children: Block[] = [];
        let index = 0;
        for (const part of parts) {
            if (part.kind === 'block') { children.push(part.block); continue; }
            const text = part.text.trim();
            if (!text) continue;
            if (type.children.allowed && !type.children.allowed.includes('core/paragraph')) { problems.push(`${frame.type} holds only ${type.children.allowed.join(', ')}: put the text in one of them.`); continue; }
            children.push({ _id: `${id}-t${++index}`, type: 'core/paragraph', data: { text } });
        }
        return { _id: id, type: frame.type, data, children };
    }
    if (parts.some(part => part.kind === 'block')) { problems.push(`${frame.type} holds no blocks; its body is text.`); return null; }
    if (!type.body) { problems.push(`${frame.type} takes no body: write {{ block ${frame.type} … /}}.`); return null; }
    if (frame.attrs[type.body] !== undefined) { problems.push(`${frame.type} gets ${type.body} twice: as an attribute and as its body.`); return null; }
    data[type.body] = parts.map(part => part.kind === 'text' ? part.text : '').join('').trim();
    return { _id: id, type: frame.type, data };
}

/** Adjacent text runs as one. */
function merge(parts: readonly TextPart[]): TextPart[] {
    const merged: TextPart[] = [];
    for (const part of parts) {
        const last = merged[merged.length - 1];
        if (part.kind === 'text' && last?.kind === 'text') merged[merged.length - 1] = { kind: 'text', text: last.text + part.text };
        else merged.push(part);
    }
    return merged;
}

/** The blocks a parsed text holds, in order, nested ones included through their containers. */
export function textBlocks(parsed: ParsedText): Block[] {
    return parsed.parts.flatMap(part => part.kind === 'block' ? [part.block] : []);
}
