/**
 * Editorial checks for search and answer engines, run in the editor as the entry changes.
 * Deterministic and client-safe: no keyphrase counting, only what engines are documented to
 * use (titles, descriptions, an answer up front, headings in order, sources, links, length).
 */
import { flattenBlocks, type Block, type BlockDeclaration } from './blocks';
import type { RichTextDoc, RichTextNode } from './richtext';

export type CheckStatus = 'ok' | 'warn' | 'info';

export interface Check {
    readonly id: string;
    readonly status: CheckStatus;
    readonly message: string;
}

export interface CheckInput {
    readonly title: string;
    /** The SEO title, when set. */
    readonly seoTitle?: string;
    readonly description?: string;
    readonly summary?: string;
    readonly blocks: readonly Block[];
    readonly types: ReadonlyMap<string, BlockDeclaration>;
    /** The site's host, to tell internal links from outbound ones; links starting with `/` are internal anyway. */
    readonly host?: string;
    /** Whether the collection's entries are articles, which engines expect to carry an answer and sources. */
    readonly article?: boolean;
}

interface Analysis {
    words: number;
    paragraphs: string[];
    headings: { level: number; text: string }[];
    links: string[];
    images: number;
    sourced: number;
    firstKind: string;
}

const words = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;

function inlineText(nodes: readonly RichTextNode[] = []): string {
    return nodes.map(node => node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? ' ' : inlineText(node.content)).join('');
}

function walkRichText(doc: RichTextDoc, into: Analysis): void {
    const visit = (nodes: readonly RichTextNode[]) => {
        for (const node of nodes) {
            for (const mark of node.marks ?? []) if (mark.type === 'link' && typeof mark.attrs?.href === 'string') into.links.push(mark.attrs.href);
            if (node.type === 'paragraph') { const text = inlineText(node.content).trim(); if (text) into.paragraphs.push(text); }
            else if (node.type === 'heading') into.headings.push({ level: Number(node.attrs?.level) || 2, text: inlineText(node.content).trim() });
            else if (node.type === 'image') into.images++;
            // Text nodes are leaves whose marks were read above; everything else recurses.
            if (node.content) visit(node.content);
        }
    };
    visit(doc.content ?? []);
}

/** What the content holds, read once for every check. */
export function analyzeContent(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): Analysis {
    const into: Analysis = { words: 0, paragraphs: [], headings: [], links: [], images: 0, sourced: 0, firstKind: '' };
    const markdownLinks = (text: string) => { for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) into.links.push(match[1]!); };
    for (const block of flattenBlocks(blocks)) {
        const type = types.get(block.type);
        if (!type) continue;
        const data = block.data;
        const text = (name: string) => typeof data[name] === 'string' ? data[name] as string : '';
        if (!into.firstKind && ['core/richtext', 'core/paragraph', 'core/answer', 'core/heading', 'core/image', 'core/gallery', 'core/embed', 'core/video', 'core/quote', 'core/list', 'core/faq', 'core/steps'].includes(block.type)) {
            // A rich text block's first node decides.
            if (block.type === 'core/richtext') {
                const doc = data.text as RichTextDoc | undefined;
                const first = doc?.content?.find(node => node.type !== 'cmsBlock');
                into.firstKind = first?.type === 'paragraph' ? 'paragraph' : first?.type === 'heading' ? 'heading' : first?.type === 'image' ? 'image' : first ? first.type : '';
            } else into.firstKind = block.type === 'core/paragraph' || block.type === 'core/answer' ? 'paragraph' : block.type.slice(5);
        }
        switch (block.type) {
            case 'core/richtext': if (data.text && typeof data.text === 'object') walkRichText(data.text as RichTextDoc, into); break;
            case 'core/paragraph': case 'core/answer': if (text('text')) { into.paragraphs.push(text('text')); markdownLinks(text('text')); } break;
            case 'core/heading': into.headings.push({ level: Number(text('level').slice(1)) || 2, text: text('text') }); break;
            case 'core/image': into.images++; break;
            case 'core/gallery': into.images += Array.isArray(data.images) ? data.images.length : 0; break;
            case 'core/claim': if (text('text')) into.paragraphs.push(text('text')); if (text('sourceUrl')) { into.links.push(text('sourceUrl')); into.sourced++; } break;
            case 'core/faq-item': if (text('question')) into.headings.push({ level: 3, text: text('question') }); if (text('answer')) { into.paragraphs.push(text('answer')); markdownLinks(text('answer')); } break;
            case 'core/step': if (text('title')) into.headings.push({ level: 3, text: text('title') }); if (text('text')) { into.paragraphs.push(text('text')); markdownLinks(text('text')); } break;
            case 'core/definition': if (text('definition')) into.paragraphs.push(text('definition')); break;
            case 'core/button': if (text('url')) into.links.push(text('url')); break;
            case 'core/card': if (text('url')) into.links.push(text('url')); if (text('text')) { into.paragraphs.push(text('text')); markdownLinks(text('text')); } break;
            case 'core/quote': if (text('text')) into.paragraphs.push(text('text')); break;
            case 'core/list': into.words += (Array.isArray(data.items) ? data.items as string[] : []).reduce((sum, item) => sum + words(String(item)), 0); break;
            default: for (const [name, declaration] of Object.entries(type.fields)) {
                if (declaration.kind === 'richtext' && data[name] && typeof data[name] === 'object') walkRichText(data[name] as RichTextDoc, into);
                else if ((declaration.kind === 'text') && typeof data[name] === 'string' && !declaration.media && !declaration.pattern) { into.paragraphs.push(data[name] as string); if (declaration.format === 'markdown') markdownLinks(data[name] as string); }
            }
        }
    }
    into.words += into.paragraphs.reduce((sum, paragraph) => sum + words(paragraph), 0) + into.headings.reduce((sum, heading) => sum + words(heading.text), 0);
    return into;
}

const isInternal = (href: string, host?: string) => href.startsWith('/') || href.startsWith('#') || (host ? href.includes(`://${host}`) : false);

/** The checks for an entry, in the order shown. */
export function entryChecks(input: CheckInput): Check[] {
    const checks: Check[] = [];
    const title = (input.seoTitle || input.title).trim();
    const push = (id: string, status: CheckStatus, message: string) => checks.push({ id, status, message });
    const titleLength = [...title].length;
    if (!title) push('title', 'warn', 'Add a title.');
    else if (titleLength > 60) push('title', 'warn', `The title is ${titleLength} characters; results cut it after about 60.`);
    else push('title', 'ok', 'The title fits a search result.');
    const description = (input.description ?? '').trim();
    const descriptionLength = [...description].length;
    if (!description) push('description', 'info', 'No meta description: engines pick a passage themselves. The summary stands in when there is one.');
    else if (descriptionLength > 160) push('description', 'warn', `The meta description is ${descriptionLength} characters; results cut it after about 155.`);
    else if (descriptionLength < 50) push('description', 'info', 'The meta description is short; a full sentence or two reads better in results.');
    else push('description', 'ok', 'The meta description fits a search result.');
    const summary = (input.summary ?? '').trim();
    if (input.article !== false) {
        if (!summary) push('summary', 'warn', 'Add a summary: two or three sentences that answer the question the entry is about. Answer engines quote it.');
        else if (words(summary) > 70) push('summary', 'info', 'The summary runs long; answer engines prefer two or three sentences.');
        else push('summary', 'ok', 'The summary answers up front.');
    }
    const content = analyzeContent(input.blocks, input.types);
    if (!content.words) { push('content', 'info', 'No content yet.'); return checks; }
    if (content.firstKind && content.firstKind !== 'paragraph') push('first', 'info', `The content opens with ${content.firstKind === 'heading' ? 'a heading' : content.firstKind === 'image' ? 'an image' : `a ${content.firstKind.replace(/-/g, ' ')}`}. A direct answer in the first paragraph is what engines quote.`);
    else if (content.paragraphs[0] && words(content.paragraphs[0]) > 60) push('first', 'info', `The first paragraph is ${words(content.paragraphs[0])} words; a direct answer of under 60 is quoted more.`);
    else if (content.paragraphs[0]) push('first', 'ok', 'The first paragraph answers directly.');
    let misordered = false;
    let last = 1;
    for (const heading of content.headings) { if (heading.level > last + 1) misordered = true; last = heading.level; }
    if (content.headings.some(heading => heading.level === 1)) push('headings', 'warn', 'The content has an H1; the title is the H1. Use H2 and below.');
    else if (misordered) push('headings', 'warn', 'A heading skips a level (an H4 after an H2). Keep headings in order.');
    else if (content.words > 300 && !content.headings.length) push('headings', 'info', 'No headings. Sections with headings are easier to scan and to quote.');
    else if (content.headings.length) push('headings', 'ok', `${content.headings.length} heading${content.headings.length === 1 ? '' : 's'}, in order.`);
    if (input.article !== false) {
        const questions = content.headings.filter(heading => /\?\s*$/.test(heading.text)).length;
        if (content.words > 300 && !questions) push('questions', 'info', 'No heading is a question. Headings phrased as the questions readers ask match what answer engines look for.');
        else if (questions) push('questions', 'ok', `${questions} heading${questions === 1 ? '' : 's'} phrased as a question.`);
    }
    const outbound = content.links.filter(href => /^https?:\/\//.test(href) && !isInternal(href, input.host));
    const internal = content.links.filter(href => isInternal(href, input.host));
    if (input.article !== false) {
        if (!outbound.length && !content.sourced) push('sources', 'info', 'No sources linked. Statistics and quotes with a linked source are what generative answers cite.');
        else push('sources', 'ok', `${content.sourced || outbound.length} source${(content.sourced || outbound.length) === 1 ? '' : 's'} linked.`);
    }
    if (!internal.length) push('internal', 'info', 'No links to other pages of the site. Internal links help engines find and rank related entries.');
    else push('internal', 'ok', `${internal.length} internal link${internal.length === 1 ? '' : 's'}.`);
    if (input.article !== false && content.words < 300) push('length', 'info', `${content.words} words. Short entries can rank; they are quoted less.`);
    else push('length', 'ok', `${content.words} words.`);
    return checks;
}
