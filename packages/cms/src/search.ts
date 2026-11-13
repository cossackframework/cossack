/**
 * What a person types into a search box, turned into RomeDB full-text syntax that never fails.
 *
 * RomeDB's index splits text on anything that is not a letter or a digit, lowercases it and
 * drops tokens of 40 bytes or more (its `default` tokenizer). The parser cuts words the same
 * way, so every word it sends can match, and quotes each one so no word reads as syntax
 * (`AND`, `NOT`, `title:`, `^2`, `*`). The last word typed is a prefix, so a search
 * finds while someone is still typing. Snippets come from RomeDB (`search::snippet`).
 */

/** Bounds on a search: characters read from the input, words and phrases kept, and the RomeDB query size. */
export const SEARCH_LIMITS = { input: 500, terms: 32, excluded: 8, bytes: 4096, tokenBytes: 40 } as const;

/** A search ready for `search::text`. */
export interface SearchQuery {
    /** Every word and phrase required, and `-word` excluded: what a search runs first. */
    readonly all: string;
    /** Any of the words or phrases, for when nothing has them all; null when that is the same search. */
    readonly any: string | null;
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
 * else is searched. The word the text ends with is a prefix (`hel` finds `hello`) when it has
 * two characters or more, or ends a split word (`e-m`); a quoted phrase, an excluded word or a
 * trailing space keeps it exact. Anything else is text. Null when nothing searchable is left.
 */
export function searchQuery(text: string): SearchQuery | null {
    if (typeof text !== 'string') return null;
    const input = text.slice(0, SEARCH_LIMITS.input);
    const include = new Map<string, string[]>();
    const exclude = new Map<string, string[]>();
    // The last word typed, while it is still the last thing in the text: a prefix.
    let tail: string | null = null;
    const add = (into: Map<string, string[]>, words: string[]) => {
        if (!words.length) return null;
        const key = words.join(' ');
        into.set(key, words);
        return key;
    };
    // Odd segments sit between two quotes; a last quote without a partner is plain text.
    const segments = input.split('"');
    for (const [index, segment] of segments.entries()) {
        if (index % 2 === 1 && index < segments.length - 1) {
            add(/(^|\s)-$/.test(segments[index - 1]!) ? exclude : include, searchWords(segment));
            tail = null;
            continue;
        }
        for (const chunk of segment.split(/\s+/)) {
            const negative = chunk.length > 1 && chunk.startsWith('-');
            const key = add(negative ? exclude : include, searchWords(negative ? chunk.slice(1) : chunk));
            tail = negative ? null : key;
        }
    }
    const included = [...include.values()].slice(0, SEARCH_LIMITS.terms);
    if (!included.length) return null;
    const keys = new Set(include.keys());
    const excluded = [...exclude.entries()].filter(([key]) => !keys.has(key)).map(([, words]) => words).slice(0, SEARCH_LIMITS.excluded);
    // RomeDB wants two characters before a one-word prefix's `*`; a split word's phrase prefix needs none.
    const prefix = tail === null ? null : include.get(tail)!;
    const growing = prefix !== null && (prefix.length > 1 || [...prefix[0]!].length > 1) ? prefix : null;
    const term = (words: string[]) => `"${words.join(' ')}"${words === growing ? '*' : ''}`;
    const not = excluded.map(words => `-"${words.join(' ')}"`);
    const all = [...included.map(words => `+${term(words)}`), ...not].join(' ');
    const any = included.length > 1 ? [...included.map(term), ...not].join(' ') : null;
    return { all, any };
}

/** Whether a RomeDB error is about a full-text query, so the CMS can answer 400 rather than 500. */
export function isSearchSyntaxError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
    return /\bfulltext:|full-text query|FTS parse error/.test(message);
}

/** One piece of a snippet, as RomeDB's `search::snippet` returns it: plain text, and whether it is a matched word. Never markup. */
export interface SnippetPart {
    readonly text: string;
    readonly match: boolean;
}
