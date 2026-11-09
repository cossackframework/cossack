import { describe, expect, it } from 'vitest';
import { isSearchSyntaxError, searchQuery, searchWords, snippetParts, SEARCH_LIMITS } from '../src/search';

/** The embedded engine, when its native addon loads here, to run the parser's output for real. */
const engine = await import('@romedb/node').then(module => {
    const db = new module.Database(':memory:');
    db.execute('CREATE TABLE docs');
    db.execute(`INSERT INTO docs {id: docs:a, title: 'Hello world', body: 'Café running e-mail fast guide at example.com'}`);
    db.execute(`INSERT INTO docs {id: docs:b, title: 'Help desk', body: 'fast database AND more'}`);
    db.execute('CREATE SEARCH INDEX docs_text ON docs(title, body) USING FULLTEXT');
    return (query: string) => db.all(`SELECT id FROM search::text('docs_text', $query, 10) ORDER BY id`, { $query: query }).map(row => String((row[0] as { key: string }).key));
}, () => undefined);

describe('searchQuery', () => {
    it('requires every word, quoted so no word reads as syntax', () => {
        expect(searchQuery('Hello World')).toEqual({ all: '+"hello" +"world"', any: '"hello" "world"', words: ['hello', 'world'] });
        expect(searchQuery('fast')).toEqual({ all: '+"fast"', any: null, words: ['fast'] });
    });

    it('treats operators, fields, boosts and wildcards as text', () => {
        expect(searchQuery('NOT x')!.all).toBe('+"not" +"x"');
        expect(searchQuery('title:x')!.all).toBe('+"title x"');
        expect(searchQuery('x^2')!.all).toBe('+"x 2"');
        expect(searchQuery('fast AND (guide OR help*)')!.all).toBe('+"fast" +"and" +"guide" +"or" +"help"');
        expect(searchQuery('~ * : ^ ( ) [ ] { }')).toBeNull();
    });

    it('keeps balanced phrases and reads an unbalanced quote as text', () => {
        expect(searchQuery('"big bad wolf" house')!.all).toBe('+"big bad wolf" +"house"');
        expect(searchQuery('"x')!.all).toBe('+"x"');
        expect(searchQuery('"a b" "c')!.all).toBe('+"a b" +"c"');
        expect(searchQuery('""')).toBeNull();
    });

    it('keeps a word that punctuation splits as a phrase, as it was indexed', () => {
        expect(searchQuery('e-mail example.com')!.all).toBe('+"e mail" +"example com"');
    });

    it('excludes only when something else is searched', () => {
        expect(searchQuery('fast -guide -"help desk"')).toEqual({ all: '+"fast" -"guide" -"help desk"', any: null, words: ['fast'] });
        expect(searchQuery('-guide')).toBeNull();
        expect(searchQuery('-')).toBeNull();
        expect(searchQuery('fast -fast')!.all).toBe('+"fast"');
    });

    it('drops words the index drops and bounds the query', () => {
        expect(searchQuery(`${'a'.repeat(40)} fast`)!.all).toBe('+"fast"');
        const many = searchQuery(Array.from({ length: 100 }, (_, index) => `w${index}`).join(' '))!;
        expect(many.all.split(' ')).toHaveLength(SEARCH_LIMITS.terms);
        expect(searchQuery('ệ'.repeat(5000))).toBeNull();
        const wide = searchQuery(Array.from({ length: 200 }, (_, index) => `${'ệ'.repeat(12)}${index}`).join(' '))!;
        expect(new TextEncoder().encode(wide.all).byteLength).toBeLessThan(SEARCH_LIMITS.bytes);
        expect(searchQuery(null as unknown as string)).toBeNull();
    });

    it('cuts words like the index: letters and digits in any script', () => {
        expect(searchWords('Tiếng Việt, 東京タワー & café_au_lait 3.14')).toEqual(['tiếng', 'việt', '東京タワー', 'café', 'au', 'lait', '3', '14']);
    });

    it.runIf(engine)('never fails in RomeDB and finds what was meant', () => {
        const run = engine!;
        for (const typed of ['NOT x', 'title:x', 'x^2', '"x', 'AND', 'OR', 'fast AND NOT guide', '(fast', 'help*', '"hel"*', '+', '-', '\\', "it's", 'a~2', '[1 TO 5]', 'IN [a b]', 'fast^', '"', '""x""']) {
            const parsed = searchQuery(typed);
            if (!parsed) continue;
            expect(() => run(parsed.all), typed).not.toThrow();
            if (parsed.any) expect(() => run(parsed.any!), typed).not.toThrow();
        }
        expect(run(searchQuery('hello world')!.all)).toEqual(['a']);
        expect(run(searchQuery('fast -guide')!.all)).toEqual(['b']);
        expect(run(searchQuery('e-mail')!.all)).toEqual(['a']);
        expect(run(searchQuery('fast AND')!.all)).toEqual(['b']);
        expect(run(searchQuery('hello desk')!.all)).toEqual([]);
        expect(run(searchQuery('hello desk')!.any!)).toEqual(['a', 'b']);
    });
});

describe('isSearchSyntaxError', () => {
    it('recognizes RomeDB full-text errors only', () => {
        expect(isSearchSyntaxError(Object.assign(new Error('validation: fulltext: invalid text query syntax'), { code: 'RDB_VALIDATION' }))).toBe(true);
        expect(isSearchSyntaxError(new Error('engine: Internal error: FTS parse error: PhrasePrefixRequiresAtLeastTwoTerms'))).toBe(true);
        expect(isSearchSyntaxError({ message: 'full-text query exceeds 4096 bytes' })).toBe(true);
        expect(isSearchSyntaxError(new Error('network down'))).toBe(false);
        expect(isSearchSyntaxError(undefined)).toBe(false);
    });
});

describe('snippetParts', () => {
    it('marks matched words in plain parts', () => {
        expect(snippetParts('The fast database, FAST again.', ['fast'])).toEqual([
            { text: 'The ', match: false }, { text: 'fast', match: true }, { text: ' database, ', match: false }, { text: 'FAST', match: true }, { text: ' again.', match: false },
        ]);
    });

    it('starts near a match deep in the text, at a word, and marks what was left out', () => {
        const text = `${'lorem ipsum '.repeat(40)}the needle is here ${'dolor sit '.repeat(40)}`;
        const parts = snippetParts(text, ['needle'], 100);
        expect(parts[0]!.text.startsWith('…')).toBe(true);
        expect(parts.at(-1)!.text.endsWith('…')).toBe(true);
        expect(parts.some(part => part.match && part.text === 'needle')).toBe(true);
        const joined = parts.map(part => part.text).join('');
        expect(joined.length).toBeLessThanOrEqual(104);
        expect(joined).toMatch(/^…\S/);
    });

    it('shows the start when nothing matches, and nothing for empty text', () => {
        expect(snippetParts('Short text.', ['other'])).toEqual([{ text: 'Short text.', match: false }]);
        expect(snippetParts('  \n ', ['x'])).toEqual([]);
        expect(snippetParts('word '.repeat(100), [], 20).map(part => part.text).join('')).toBe('word word word word…');
    });

    it('never yields markup of its own', () => {
        expect(snippetParts('<b>fast</b> & <script>', ['fast'])).toEqual([{ text: '<b>', match: false }, { text: 'fast', match: true }, { text: '</b> & <script>', match: false }]);
    });
});
