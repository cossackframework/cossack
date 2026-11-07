/**
 * The headings of an entry's content, for `core/toc`: each `core/heading` gets an anchor
 * (its own from Advanced settings, else one made from its text, kept distinct), and every
 * table of contents in the content receives the list. Client-safe; the server runs it once
 * per entry after the content is rendered.
 */
import { slugify, type RenderedBlock } from '@cossackframework/cms';

export interface HeadingView {
    /** The anchor the heading's wrapper carries, without `#`. */
    readonly id: string;
    readonly text: string;
    /** 2, 3 or 4. */
    readonly level: number;
}

const LEVELS: Readonly<Record<string, number>> = { h2: 2, h3: 3, h4: 4 };

/** An anchor from a heading's text: a letter first, at most 60 characters, `section` when nothing is left. */
export function headingAnchor(text: string): string {
    const slug = slugify(text).slice(0, 60).replace(/-+$/, '');
    return !slug ? 'section' : /^[A-Za-z]/.test(slug) ? slug : `h-${slug}`.slice(0, 60);
}

/** The content with its headings anchored and its tables of contents filled; unchanged when it has neither. */
export function withHeadingAnchors(blocks: readonly RenderedBlock[]): RenderedBlock[] {
    const taken = new Set<string>();
    const headings: HeadingView[] = [];
    let changed = false;
    const anchor = (block: RenderedBlock): RenderedBlock => {
        if (block.type === 'core/heading') {
            const text = typeof block.data.text === 'string' ? block.data.text.trim() : '';
            const level = LEVELS[typeof block.data.level === 'string' ? block.data.level : 'h2'] ?? 2;
            let id = block.layout?.anchor || headingAnchor(text);
            for (let n = 2; taken.has(id); n++) id = `${headingAnchor(text).slice(0, 56)}-${n}`;
            taken.add(id);
            headings.push({ id, text, level });
            if (block.layout?.anchor !== id) { changed = true; return { ...block, layout: { ...block.layout, anchor: id } }; }
            return block;
        }
        if (block.type === 'core/toc') changed = true;
        if (!block.children?.length) return block;
        const children = block.children.map(anchor);
        return children.some((child, index) => child !== block.children![index]) ? { ...block, children } : block;
    };
    const anchored = blocks.map(anchor);
    if (!changed) return anchored;
    const fill = (block: RenderedBlock): RenderedBlock => block.type === 'core/toc' ? { ...block, headings }
        : block.children?.length ? { ...block, children: block.children.map(fill) } : block;
    return anchored.map(fill);
}
