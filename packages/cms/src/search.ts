/**
 * What a person types into a search box, turned into RomeDB full-text syntax that never fails,
 * and the plain-text snippets that show where it matched.
 *
 * RomeDB's index splits text on anything that is not a letter or a digit, lowercases it and
 * drops tokens of 40 bytes or more (its `default` tokenizer). The parser cuts words the same
 * way, so every word it sends can match, and quotes each one so no word reads as syntax
 * (`AND`, `NOT`, `title:`, `^2`, `*`).
 */

/** Bounds on a search: characters read from the input, words and phrases kept, and the RomeDB query size. */
export const SEARCH_LIMITS = { input: 500, terms: 32, excluded: 8, bytes: 4096, tokenBytes: 40 } as const;

/** A search ready for `search::text`. */
export interface SearchQuery {
    /** Every word and phrase required, and `-word` excluded: what a search runs first. */
    readonly all: string;
    /** Any of the words or phrases, for when nothing has them all; null when that is the same search. */
    readonly any: string | null;
    /** The lowercase words that count as matches, for snippets. */
    readonly words: readonly string[];
}

const WORD = /[\p{Alphabetic}\p{N}]+/gu;
const encoder = new TextEncoder();

/** The words RomeDB indexes in `text`: letters and digits, lowercased, under 40 bytes each. */
export function searchWords(text: string): string[] {
    return (text.match(WORD) ?? []).map(word => word.toLowerCase()).filter(word => encoder.encode(word).byteLength < SEARCH_LIMITS.tokenBytes);
}

/**
 * Parse what someone typed. Words are all required, as WordPress searches. Balanced
 * `"quoted phrases"` stay phrases, and so does a word that punctuation splits (`e-mail`,
 * `example.com`), the way it was indexed. `-word` and `-"a phrase"` exclude when something
 * else is searched. Anything else is text. Null when nothing searchable is left.
 */
export function searchQuery(text: string): SearchQuery | null {
    if (typeof text !== 'string') return null;
    const input = text.slice(0, SEARCH_LIMITS.input);
    const include = new Map<string, string[]>();
    const exclude = new Map<string, string[]>();
    const add = (into: Map<string, string[]>, words: string[]) => { if (words.length) into.set(words.join(' '), words); };
    // Odd segments sit between two quotes; a last quote without a partner is plain text.
    const segments = input.split('"');
    segments.forEach((segment, index) => {
        if (index % 2 === 1 && index < segments.length - 1) {
            const before = segments[index - 1]!;
            add(/(^|\s)-$/.test(before) ? exclude : include, searchWords(segment));
            return;
        }
        for (const chunk of segment.split(/\s+/)) {
            const negative = chunk.length > 1 && chunk.startsWith('-');
            add(negative ? exclude : include, searchWords(negative ? chunk.slice(1) : chunk));
        }
    });
    const included = [...include.values()].slice(0, SEARCH_LIMITS.terms);
    if (!included.length) return null;
    const keys = new Set(include.keys());
    const excluded = [...exclude.entries()].filter(([key]) => !keys.has(key)).map(([, words]) => words).slice(0, SEARCH_LIMITS.excluded);
    const term = (words: string[]) => `"${words.join(' ')}"`;
    const not = excluded.map(words => `-${term(words)}`);
    const all = [...included.map(words => `+${term(words)}`), ...not].join(' ');
    const any = included.length > 1 ? [...included.map(term), ...not].join(' ') : null;
    return { all, any, words: [...new Set(included.flat())] };
}

/** Whether a RomeDB error is about a full-text query, so the CMS can answer 400 rather than 500. */
export function isSearchSyntaxError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
    return /\bfulltext:|full-text query|FTS parse error/.test(message);
}

/** One piece of a snippet: plain text, and whether it is a matched word. Never markup. */
export interface SnippetPart {
    readonly text: string;
    readonly match: boolean;
}

/**
 * About `size` characters of `text` around the first matched word, cut at word boundaries,
 * with `…` where text was left out, split into matched and unmatched parts. The start of the
 * text when no word matches; empty for empty text.
 */
export function snippetParts(text: string, words: readonly string[], size = 160): SnippetPart[] {
    const source = text.replace(/\s+/g, ' ').trim();
    if (!source) return [];
    const wanted = new Set(words.map(word => word.toLowerCase()));
    const tokens = [...source.matchAll(WORD)].map(found => ({ start: found.index, end: found.index + found[0].length, match: wanted.has(found[0].toLowerCase()) }));
    const first = tokens.find(token => token.match);
    let start = 0;
    if (first && first.end > size * 0.6) {
        // Start a little before the match, at a word.
        const from = Math.max(0, first.start - Math.round(size * 0.3));
        start = tokens.find(token => token.start >= from)?.start ?? first.start;
    }
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
        const last = tokens.filter(token => token.end <= end && token.start >= start).at(-1);
        if (last && last.end > start) end = last.end;
    }
    const parts: SnippetPart[] = [];
    const push = (value: string, match: boolean) => {
        if (!value) return;
        const previous = parts.at(-1);
        if (previous && previous.match === match && !match) parts[parts.length - 1] = { text: previous.text + value, match };
        else parts.push({ text: value, match });
    };
    if (start > 0) push('…', false);
    let at = start;
    for (const token of tokens) {
        if (token.start < start || token.end > end || !token.match) continue;
        push(source.slice(at, token.start), false);
        push(source.slice(token.start, token.end), true);
        at = token.end;
    }
    push(source.slice(at, end), false);
    if (end < source.length) push('…', false);
    return parts;
}
