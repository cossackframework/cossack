/**
 * Code highlighting on the server: a small tokenizer for the languages a site's code blocks
 * usually hold, writing `<span class="tok-…">` runs the stylesheet colors. Comments, strings,
 * numbers, keywords, types, calls, tags, attributes and operators are told apart; everything
 * else is left as written. No dependency and no script on the site; a theme that wants a full
 * grammar swaps in its own highlighter through `helpers`. Pure functions.
 */
/** HTML-escape text for a code element. */
function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Token classes: comment, string, number, keyword, type, function, attribute (or property), tag, operator, inserted, deleted. */
export type TokenClass = 'c' | 's' | 'n' | 'k' | 't' | 'f' | 'a' | 'g' | 'o' | 'i' | 'd';

interface Rule { readonly pattern: RegExp; readonly token: TokenClass | null; readonly keywords?: ReadonlySet<string>; readonly types?: ReadonlySet<string> }
interface Grammar { readonly rules: readonly Rule[] }

const words = (list: string) => new Set(list.split(' '));
const C_KEYWORDS = words('abstract as async await break case catch class const continue debugger default delete do else enum export extends false final finally for from function get if implements import in instanceof interface let new null of package private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield declare namespace module keyof infer is override unknown any never object struct fn pub mut impl trait use mod match loop where self crate dyn ref move unsafe func go chan defer select range map var val fun when sealed data companion internal lateinit open override inline reified vararg guard repeat defer inout typealias associatedtype protocol extension subscript operator convenience required mutating nonmutating willSet didSet fileprivate throws rethrows some #if #else #endif echo print namespace fn using unset isset elseif endif foreach endforeach global goto include include_once require require_once instanceof insteadof clone declare');
const C_TYPES = words('string number boolean bigint symbol int long short byte char float double void bool uint usize isize i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 str String Vec Option Result Box Map Set Array Promise Record Partial Readonly Date Error Object Function Number Boolean Symbol Int Float Double Char Long Short Byte Unit Nothing List Dictionary Any Self error');
const PY_KEYWORDS = words('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls print begin end do then unless until module require rescue ensure yield next redo retry nil puts attr_accessor attr_reader attr_writer private protected public super alias undef defined? __method__ loop proc');
const PY_TYPES = words('int str float bool list dict set tuple bytes object type Exception ValueError TypeError KeyError Integer String Array Hash Symbol Float Numeric Proc Class Module Struct');
const SH_KEYWORDS = words('if then else elif fi for while until do done case esac in function select time coproc return exit break continue local export readonly declare typeset unset shift source alias set eval exec trap');
const SQL_KEYWORDS = words('select from where and or not in is null as insert into values update set delete create table index view drop alter add column primary key foreign references unique default check constraint join inner left right full outer on group by having order asc desc limit offset union all distinct exists between like case when then else end with returning begin commit rollback transaction truncate if replace grant revoke explain analyze using cross natural');
const SQL_TYPES = words('int integer bigint smallint serial text varchar char boolean bool date timestamp timestamptz time interval numeric decimal real float double json jsonb uuid bytea blob');
const CSS_KEYWORDS = words('@media @import @font-face @keyframes @supports @layer @container @property @charset @page @namespace @tailwind @apply @theme @utility @variant @custom-variant !important');

const COMMENT_SLASH: Rule = { pattern: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, token: 'c' };
const COMMENT_HASH: Rule = { pattern: /#[^\n]*/y, token: 'c' };
const STRING: Rule = { pattern: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?/y, token: 's' };
const NUMBER: Rule = { pattern: /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[a-zA-Z%]{0,4})?\b/y, token: 'n' };
const CALL: Rule = { pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/y, token: 'f' };
const WORD: Rule = { pattern: /[A-Za-z_$@#][\w$]*\??/y, token: null, keywords: C_KEYWORDS, types: C_TYPES };
const OPERATOR: Rule = { pattern: /=>|->|::|[-+*/%=!<>&|^~?:]+/y, token: 'o' };
const SPACE: Rule = { pattern: /\s+|[^\s\w"'`#/=<>!&|^~?:+*%-]+/y, token: null };

const C_LIKE: Grammar = { rules: [COMMENT_SLASH, STRING, NUMBER, CALL, WORD, OPERATOR, SPACE] };
const PYTHON: Grammar = { rules: [COMMENT_HASH, { pattern: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y, token: 's' }, STRING, NUMBER, { pattern: /@\w+/y, token: 'a' }, CALL, { ...WORD, keywords: PY_KEYWORDS, types: PY_TYPES }, OPERATOR, SPACE] };
const SHELL: Grammar = { rules: [COMMENT_HASH, STRING, { pattern: /\$\{[^}\n]*\}|\$[\w@#?!$*]+/y, token: 'a' }, { pattern: /(?<=^|[|;&]\s*|\$\(\s*)[A-Za-z_][\w.-]*/my, token: 'f' }, { pattern: /\s-{1,2}[\w-]+/y, token: 'a' }, NUMBER, { ...WORD, keywords: SH_KEYWORDS, types: new Set() }, OPERATOR, SPACE] };
const SQL: Grammar = { rules: [{ pattern: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, token: 'c' }, STRING, NUMBER, CALL, { pattern: /[A-Za-z_][\w$]*/y, token: null, keywords: SQL_KEYWORDS, types: SQL_TYPES }, OPERATOR, SPACE] };
const JSON_GRAMMAR: Grammar = { rules: [COMMENT_SLASH, { pattern: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, token: 'a' }, STRING, NUMBER, { pattern: /\b(?:true|false|null)\b/y, token: 'k' }, OPERATOR, SPACE, { pattern: /[A-Za-z_]\w*/y, token: null }] };
const YAML: Grammar = { rules: [COMMENT_HASH, { pattern: /^\s*-?\s*[\w.\-"']+(?=\s*:(?:\s|$))/my, token: 'a' }, STRING, { pattern: /\b(?:true|false|null|yes|no|on|off|~)\b/y, token: 'k' }, NUMBER, { pattern: /&\w+|\*\w+|!!?\w+/y, token: 't' }, OPERATOR, SPACE, { pattern: /[^\s]+/y, token: null }] };
const CSS: Grammar = { rules: [COMMENT_SLASH, STRING, { pattern: /@[\w-]+|!important/y, token: 'k' }, { pattern: /#[0-9a-fA-F]{3,8}\b/y, token: 'n' }, { pattern: /[\w-]+(?=\s*:(?!:))/y, token: 'a' }, { pattern: /\.[A-Za-z_-][\w-]*|#[A-Za-z_-][\w-]*|::?[\w-]+(?:\([^)]*\))?/y, token: 'g' }, NUMBER, CALL, { pattern: /[A-Za-z_-][\w-]*/y, token: null }, OPERATOR, SPACE] };
const DIFF: Grammar = { rules: [{ pattern: /^@@[^\n]*/my, token: 'k' }, { pattern: /^\+[^\n]*/my, token: 'i' }, { pattern: /^-[^\n]*/my, token: 'd' }, { pattern: /^[^\n]*\n?/my, token: null }] };

const GRAMMARS: { readonly [language: string]: Grammar } = {
    js: C_LIKE, javascript: C_LIKE, jsx: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, ts: C_LIKE, typescript: C_LIKE, tsx: C_LIKE, java: C_LIKE, c: C_LIKE, cpp: C_LIKE, 'c++': C_LIKE, h: C_LIKE,
    cs: C_LIKE, csharp: C_LIKE, 'c#': C_LIKE, go: C_LIKE, golang: C_LIKE, rust: C_LIKE, rs: C_LIKE, kotlin: C_LIKE, kt: C_LIKE, swift: C_LIKE, php: C_LIKE, dart: C_LIKE, scala: C_LIKE, groovy: C_LIKE,
    python: PYTHON, py: PYTHON, ruby: PYTHON, rb: PYTHON,
    bash: SHELL, sh: SHELL, shell: SHELL, zsh: SHELL, fish: SHELL, console: SHELL, powershell: SHELL, ps1: SHELL,
    sql: SQL, mysql: SQL, postgres: SQL, postgresql: SQL, sqlite: SQL, rql: SQL,
    json: JSON_GRAMMAR, jsonc: JSON_GRAMMAR, json5: JSON_GRAMMAR,
    yaml: YAML, yml: YAML, toml: YAML, ini: YAML, env: YAML, dotenv: YAML,
    css: CSS, scss: CSS, sass: CSS, less: CSS,
    diff: DIFF, patch: DIFF,
};

/** Languages the tokenizer knows; others are escaped as written. */
export const HIGHLIGHT_LANGUAGES: readonly string[] = Object.freeze([...Object.keys(GRAMMARS), 'html', 'xml', 'svg', 'vue', 'svelte', 'astro', 'markup', 'jinja', 'twig', 'blade']);

/** The language a code block names, normalized; empty when unknown. */
export function highlightLanguage(language: unknown): string {
    const name = typeof language === 'string' ? language.trim().toLowerCase() : '';
    return HIGHLIGHT_LANGUAGES.includes(name) ? name : '';
}

/** Code as escaped HTML with token spans; plain escaped text for a language the tokenizer does not know. */
export function highlightCode(code: string, language?: unknown): string {
    const name = highlightLanguage(language);
    if (!name) return escapeHtml(code);
    if (['html', 'xml', 'svg', 'vue', 'svelte', 'astro', 'markup', 'jinja', 'twig', 'blade'].includes(name)) return markup(code);
    return tokenize(code, GRAMMARS[name]!);
}

function span(token: TokenClass | null, text: string): string {
    const safe = escapeHtml(text);
    return token ? `<span class="tok-${token}">${safe}</span>` : safe;
}

function tokenize(code: string, grammar: Grammar): string {
    let out = '';
    let position = 0;
    while (position < code.length) {
        let matched = false;
        for (const rule of grammar.rules) {
            rule.pattern.lastIndex = position;
            const match = rule.pattern.exec(code);
            if (!match || match.index !== position || !match[0].length) continue;
            const text = match[0];
            let token = rule.token;
            if (token === null && (rule.keywords || rule.types)) {
                const lower = text.toLowerCase();
                if (rule.keywords?.has(text) || rule.keywords?.has(lower)) token = 'k';
                else if (rule.types?.has(text)) token = 't';
            }
            out += span(token, text);
            position += text.length;
            matched = true;
            break;
        }
        if (!matched) { out += escapeHtml(code[position]!); position++; }
    }
    return out;
}

/** HTML and XML: comments, tags with their attributes and values, text as written; the content of style and script elements is highlighted by its language. */
function markup(code: string): string {
    const pattern = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<!DOCTYPE[^>]*>|<\/?[A-Za-z][\w:.-]*(?:\s+[^<>]*?)?\/?>|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
    let out = '';
    let last = 0;
    for (const match of code.matchAll(pattern)) {
        out += escapeHtml(code.slice(last, match.index));
        const text = match[0];
        if (text.startsWith('<!--') || text.startsWith('<![CDATA[')) out += span('c', text);
        else if (text.startsWith('<!')) out += span('k', text);
        else if (text.startsWith('{{') || text.startsWith('{%')) out += span('a', text);
        else out += tag(text);
        last = match.index + text.length;
    }
    return out + escapeHtml(code.slice(last));
}

function tag(text: string): string {
    const head = /^(<\/?)([A-Za-z][\w:.-]*)/.exec(text)!;
    let out = escapeHtml(head[1]!) + span('g', head[2]!);
    const rest = text.slice(head[0].length);
    const attributes = /([^\s=\/>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?|\s+|\/?>/g;
    let last = 0;
    for (const match of rest.matchAll(attributes)) {
        out += escapeHtml(rest.slice(last, match.index));
        if (match[1]) out += span('a', match[1]) + escapeHtml(match[2] ?? '') + (match[3] ? span('s', match[3]) : '');
        else out += escapeHtml(match[0]);
        last = match.index + match[0].length;
    }
    return out + escapeHtml(rest.slice(last));
}
