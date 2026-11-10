import { describe, expect, it } from 'vitest';
import { isSearchSyntaxError, searchQuery, searchWords, SEARCH_LIMITS } from '../src/search';

/** The embedded engine, when its native addon loads here, to run the parser's output for real. */
const engine = await import('@romedb/node').then(module => {
    const db = new module.Database(':memory:');
    db.execute('CREATE TABLE docs');
    db.execute(`INSERT INTO docs {id: docs:a, title: 'Hello world', body: 'Café running e-mail fast guide at example.com'}`);
    db.execute(`INSERT INTO docs {id: docs:b, title: 'Help desk', body: 'fast database AND more'}`);
    db.execute(`CREATE SEARCH INDEX docs_text ON docs(title, body) USING FULLTEXT WITH (weights='title=3')`);
    return {
        search: (query: string) => db.all(`SELECT id FROM search::text('docs_text', $query, 10) ORDER BY id`, { $query: query }).map(row => String((row[0] as { key: string }).key)),
        snippet: (text: string, query: string) => db.all(`SELECT search::snippet('docs_text', $text, $query, 40)`, { $text: text, $query: query })[0]![0] as { text: string; match: boolean }[],
    };
}, () => undefined);

describe('searchQuery', () => {
    it('requires every word, quoted so no word reads as syntax, and the last one may be a prefix', () => {
        expect(searchQuery('Hello World')).toEqual({ all: '+"hello" +"world"*', any: '"hello" "world"*' });
        expect(searchQuery('fast')).toEqual({ all: '+"fast"*', any: null });
    });

    it('makes a prefix only of the word the text ends with, of two characters or a split word', () => {
        expect(searchQuery('hel')!.all).toBe('+"hel"*');
        expect(searchQuery('hello ')!.all).toBe('+"hello"');
        expect(searchQuery('h')!.all).toBe('+"h"');
        expect(searchQuery('hello w')!.all).toBe('+"hello" +"w"');
        expect(searchQuery('e-m')!.all).toBe('+"e m"*');
        expect(searchQuery('"hel"')!.all).toBe('+"hel"');
        expect(searchQuery('fast -gui')!.all).toBe('+"fast" -"gui"');
        expect(searchQuery('hel !!')!.all).toBe('+"hel"');
        expect(searchQuery('hello hel hello')!.all).toBe('+"hello"* +"hel"');
    });

    it('treats operators, fields, boosts and wildcards as text', () => {
        expect(searchQuery('NOT x')!.all).toBe('+"not" +"x"');
        expect(searchQuery('title:x')!.all).toBe('+"title x"*');
        expect(searchQuery('x^2')!.all).toBe('+"x 2"*');
        expect(searchQuery('fast AND (guide OR help*)')!.all).toBe('+"fast" +"and" +"guide" +"or" +"help"*');
        expect(searchQuery('~ * : ^ ( ) [ ] { }')).toBeNull();
    });

    it('keeps balanced phrases and reads an unbalanced quote as text', () => {
        expect(searchQuery('"big bad wolf" house')!.all).toBe('+"big bad wolf" +"house"*');
        expect(searchQuery('house "big bad wolf"')!.all).toBe('+"house" +"big bad wolf"');
        expect(searchQuery('"x')!.all).toBe('+"x"');
        expect(searchQuery('"a b" "c')!.all).toBe('+"a b" +"c"');
        expect(searchQuery('""')).toBeNull();
    });

    it('keeps a word that punctuation splits as a phrase, as it was indexed', () => {
        expect(searchQuery('e-mail example.com')!.all).toBe('+"e mail" +"example com"*');
    });

    it('excludes only when something else is searched', () => {
        expect(searchQuery('fast -guide -"help desk"')).toEqual({ all: '+"fast" -"guide" -"help desk"', any: null });
        expect(searchQuery('-guide')).toBeNull();
        expect(searchQuery('-')).toBeNull();
        expect(searchQuery('fast -fast')!.all).toBe('+"fast"');
    });

    it('drops words the index drops and bounds the query', () => {
        expect(searchQuery(`${'a'.repeat(40)} fast`)!.all).toBe('+"fast"*');
        const many = searchQuery(Array.from({ length: 100 }, (_, index) => `w${index}`).join(' '))!;
        expect(many.all.split(' ')).toHaveLength(SEARCH_LIMITS.terms);
        expect(many.all).not.toContain('*');
        expect(searchQuery('ệ'.repeat(5000))).toBeNull();
        const wide = searchQuery(Array.from({ length: 200 }, (_, index) => `${'ệ'.repeat(12)}${index}`).join(' '))!;
        expect(new TextEncoder().encode(wide.all).byteLength).toBeLessThan(SEARCH_LIMITS.bytes);
        expect(searchQuery(null as unknown as string)).toBeNull();
    });

    it('cuts words like the index: letters and digits in any script', () => {
        expect(searchWords('Tiếng Việt, 東京タワー & café_au_lait 3.14')).toEqual(['tiếng', 'việt', '東京タワー', 'café', 'au', 'lait', '3', '14']);
    });

    it.runIf(engine)('never fails in RomeDB and finds what was meant', () => {
        const { search } = engine!;
        for (const typed of ['NOT x', 'title:x', 'x^2', '"x', 'AND', 'OR', 'fast AND NOT guide', '(fast', 'help*', '"hel"*', '+', '-', '\\', "it's", 'a~2', '[1 TO 5]', 'IN [a b]', 'fast^', '"', '""x""', 'h', 'e-m', 'ệ']) {
            const parsed = searchQuery(typed);
            if (!parsed) continue;
            expect(() => search(parsed.all), typed).not.toThrow();
            if (parsed.any) expect(() => search(parsed.any!), typed).not.toThrow();
        }
        expect(search(searchQuery('hello world')!.all)).toEqual(['a']);
        expect(search(searchQuery('fast -guide')!.all)).toEqual(['b']);
        expect(search(searchQuery('e-mail')!.all)).toEqual(['a']);
        expect(search(searchQuery('fast AND')!.all)).toEqual(['b']);
        expect(search(searchQuery('hello desk')!.all)).toEqual([]);
        expect(search(searchQuery('hello desk')!.any!)).toEqual(['a', 'b']);
    });

    it.runIf(engine)('finds words while they are typed, and RomeDB marks them in snippets', () => {
        const { search, snippet } = engine!;
        expect(search(searchQuery('hel')!.all)).toEqual(['a', 'b']);
        expect(search(searchQuery('fast he')!.all)).toEqual(['a', 'b']);
        expect(search(searchQuery('run')!.all)).toEqual(['a']);
        expect(search(searchQuery('h')!.all)).toEqual([]);
        expect(snippet('Café running e-mail fast guide', searchQuery('fast ru')!.all)).toEqual([
            { text: 'Café ', match: false }, { text: 'running', match: true }, { text: ' e-mail ', match: false }, { text: 'fast', match: true }, { text: ' guide', match: false },
        ]);
        expect(snippet('<b>fast</b> & <script>', searchQuery('fast')!.all)).toEqual([{ text: '<b>', match: false }, { text: 'fast', match: true }, { text: '</b> & <script>', match: false }]);
        expect(snippet('', searchQuery('fast')!.all)).toEqual([]);
    });
});

describe('isSearchSyntaxError', () => {
    it('recognizes RomeDB full-text errors only', () => {
        expect(isSearchSyntaxError(Object.assign(new Error('validation: fulltext: invalid text query syntax'), { code: 'RDB_VALIDATION' }))).toBe(true);
        expect(isSearchSyntaxError(Object.assign(new Error('validation: fulltext: a prefix needs at least 2 characters before *'), { code: 'RDB_VALIDATION' }))).toBe(true);
        expect(isSearchSyntaxError(new Error('engine: Internal error: FTS parse error: PhrasePrefixRequiresAtLeastTwoTerms'))).toBe(true);
        expect(isSearchSyntaxError({ message: 'full-text query exceeds 4096 bytes' })).toBe(true);
        expect(isSearchSyntaxError(new Error('network down'))).toBe(false);
        expect(isSearchSyntaxError(undefined)).toBe(false);
    });
});
