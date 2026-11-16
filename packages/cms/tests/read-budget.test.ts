/**
 * The result budget (specs/cms-invariants.md, rule 5): a read that can return many rows with large
 * columns (whole documents, text, JSON) goes through `readPaged` or `readByIds`, which read again
 * in smaller pieces when a result is too large. This scans every direct `.read(` in the CMS server
 * and app helpers: a statement selecting large columns must be single-row, or reviewed below.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SOURCES = ['src/server', 'app/src/cms'];

/** Columns or selections that can be large: whole rows, interpolated column lists, text and JSON. */
const LARGE = /SELECT\s+\*|SELECT\s+[^F]*\$\{|\b(data|content|meta|items|blocks|payload|body|document|value|values|text|logs|recovery|description|settings|config|record|snapshot|definition|declaration|plan|state|fields|schema|permissions)\b/i;

/**
 * Multi-row reads of large-looking selections that were reviewed and stay direct, by file and the
 * start of the statement, with why their result stays small.
 */
const REVIEWED: Record<string, string> = {
    // Small columns: names, emails, dates, flags, hashes.
    'src/server/accounts.ts: SELECT ${COLUMNS} FROM cms_accounts${where} ORDER BY': 'account columns are short',
    'src/server/accounts.ts: SELECT ${MOVED.cms_accounts.join(': 'one account',
    'src/server/accounts.ts: SELECT ${MOVED.cms_api_tokens.join(': 'token hashes and names',
    'src/server/accounts.ts: SELECT ${MOVED.cms_user_security.join(': 'one row',
    'src/server/api-tokens.ts: SELECT ${COLUMNS} FROM cms_api_tokens WHERE user_id': 'token names and dates',
    'src/server/redirects.ts: SELECT ${COLUMNS} FROM cms_redirects WHERE prefix = 1': 'paths of at most 2000 characters',
    'src/server/redirects.ts: SELECT ${COLUMNS} FROM cms_redirects${where} ORDER BY': 'paths of at most 2000 characters, 100 a page',
    'src/server/security.ts: SELECT ${PASSKEY_COLUMNS} FROM cms_passkeys WHERE user_id': 'public keys of a few hundred bytes, 50 at most',
    'src/server/sites.ts: SELECT ${COLUMNS} FROM cms_sites WHERE id IN': 'site names and states',
    'src/server/webhooks.ts: SELECT ${COLUMNS} FROM cms_webhooks ORDER BY': 'URLs and event names',
    'src/server/webhooks.ts: SELECT ${DELIVERY_COLUMNS} FROM cms_webhook_deliveries WHERE': 'statuses and short errors, no payload',
    'src/server/files.ts: SELECT key, ${id} FROM ${table} WHERE key >': 'storage keys',
    'src/server/network-policy.ts: SELECT key, value FROM cms_network WHERE key IN': 'two state values',
    'src/server/repository.ts: SELECT ${quote(name)} FROM type::record(': 'one field of one record',
    // Bounded by construction.
    'src/server/site-search.ts: SELECT s.collection, s.entry, search::snippet(': 'snippets of a fixed length, one page',
    'src/server/site-settings.ts: SELECT key, value FROM cms_settings WHERE key >': 'halves its own page on a result that is too large',
};

function files(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : []);
}

/** Each statement text in each `.read(` call: file, line and the normalized SELECT. */
function directReads(): { file: string; line: number; select: string }[] {
    const found: { file: string; line: number; select: string }[] = [];
    for (const file of SOURCES.flatMap(files)) {
        const source = readFileSync(join(ROOT, file), 'utf8');
        for (let index = source.indexOf('.read('); index !== -1; index = source.indexOf('.read(', index + 1)) {
            let depth = 0;
            let end = index + 5;
            for (; end < source.length; end++) {
                if (source[end] === '(') depth++;
                else if (source[end] === ')' && --depth === 0) break;
            }
            const call = source.slice(index, end + 1);
            const line = source.slice(0, index).split('\n').length;
            for (const match of call.matchAll(/SELECT[\s\S]*?(?=['`]\s*[,}])/g)) found.push({ file: relative(ROOT, join(ROOT, file)), line, select: match[0].replace(/\s+/g, ' ') });
        }
    }
    return found;
}

/** A read that returns one row: equality conditions on parameters, no ORDER BY, no IN list, no LIMIT above 1. */
function singleRow(select: string): boolean {
    return /\bWHERE\b/.test(select) && !/ORDER BY|\bIN\b/.test(select) && !/LIMIT\s+(?!1\b)\S/.test(select);
}

describe('result budget', () => {
    it('reads large columns of many rows only through readPaged or readByIds', () => {
        const reads = directReads();
        expect(reads.length).toBeGreaterThan(100);
        const unreviewed = reads.filter(({ file, select }) => {
            const head = select.split(/\bFROM\b/i)[0]!;
            if (/^SELECT\s+(record::id\(id\)|id)(\s|,|$)/.test(select) || !LARGE.test(head) || singleRow(select)) return false;
            return !Object.keys(REVIEWED).some(key => `${file}: ${select}`.startsWith(key));
        });
        expect(unreviewed.map(({ file, line, select }) => `${file}:${line} ${select.slice(0, 120)}`),
            'Read many rows with large columns through readPaged or readByIds (server/budget.ts), or add a reviewed entry with why the result stays small').toEqual([]);
    });

    it('keeps every reviewed entry in use', () => {
        const reads = directReads().map(({ file, select }) => `${file}: ${select}`);
        expect(Object.keys(REVIEWED).filter(key => !reads.some(read => read.startsWith(key)))).toEqual([]);
    });
});
