import type { StudioProvider } from './schema-types.js';

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(
  identifier: string,
  provider: StudioProvider = 'sqlite',
): string {
  if (!identifier) throw new Error('Database identifiers cannot be empty.');
  if (provider === 'mysql') return `\`${identifier.replaceAll('`', '``')}\``;
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function assertIdentifier(identifier: string): void {
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }
}

export function sqliteAffinity(type: string): 'integer' | 'real' | 'text' | 'blob' | 'numeric' {
  const normalized = type.toUpperCase();
  if (normalized.includes('INT')) return 'integer';
  if (normalized.includes('CHAR') || normalized.includes('CLOB') || normalized.includes('TEXT')) {
    return 'text';
  }
  if (normalized.includes('BLOB') || normalized.length === 0) return 'blob';
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) {
    return 'real';
  }
  return 'numeric';
}

export function sqliteDeclaredKind(
  type: string,
): 'varchar' | 'number' | 'date' | 'datetime' | 'text' | 'json' | 'blob' | 'boolean' | 'other' {
  const normalized = type.trim().toUpperCase();
  if (normalized.includes('JSON')) return 'json';
  if (normalized.includes('BLOB') || normalized === '') return 'blob';
  if (normalized.includes('DATETIME') || normalized.includes('TIMESTAMP') ||
      normalized.includes('TIME')) return 'datetime';
  if (normalized === 'DATE' || normalized.startsWith('DATE(')) return 'date';
  if (normalized.includes('BOOL')) return 'boolean';
  if (normalized.includes('VARCHAR') || normalized.includes('NVARCHAR') ||
      normalized.includes('CHARACTER') || /^CHAR(?:\s*\(|$)/.test(normalized)) return 'varchar';
  if (normalized.includes('TEXT') || normalized.includes('CLOB')) return 'text';
  if (normalized.includes('INT') || normalized.includes('REAL') ||
      normalized.includes('FLOA') || normalized.includes('DOUB') ||
      normalized.includes('NUM') || normalized.includes('DEC')) return 'number';
  return 'other';
}

export function declaredColumnKind(
  type: string,
): ReturnType<typeof sqliteDeclaredKind> {
  const normalized = type.trim().toUpperCase();
  if (normalized === 'JSON' || normalized === 'JSONB') return 'json';
  if (
    normalized.includes('BYTEA') ||
    normalized.includes('BINARY') ||
    normalized.includes('BLOB')
  ) return 'blob';
  if (
    normalized.includes('TIMESTAMP') ||
    normalized.includes('DATETIME') ||
    normalized.startsWith('TIME')
  ) return 'datetime';
  if (normalized === 'DATE') return 'date';
  if (
    normalized.includes('BOOL') ||
    normalized === 'BIT' ||
    normalized.startsWith('BIT(') ||
    /^TINYINT\s*\(\s*1\s*\)/.test(normalized)
  ) {
    return 'boolean';
  }
  if (
    normalized.includes('VARCHAR') ||
    normalized.includes('CHARACTER VARYING') ||
    normalized.includes('NVARCHAR') ||
    /^CHAR(?:ACTER)?(?:\s*\(|$)/.test(normalized)
  ) return 'varchar';
  if (
    normalized.includes('TEXT') ||
    normalized.includes('CLOB') ||
    normalized.includes('ENUM') ||
    normalized.includes('SET')
  ) return 'text';
  if (
    normalized.includes('INT') ||
    normalized.includes('SERIAL') ||
    normalized.includes('REAL') ||
    normalized.includes('FLOA') ||
    normalized.includes('DOUB') ||
    normalized.includes('NUM') ||
    normalized.includes('DEC') ||
    normalized.includes('MONEY')
  ) return 'number';
  return sqliteDeclaredKind(type);
}

export function columnAffinity(
  type: string,
): ReturnType<typeof sqliteAffinity> {
  const normalized = type.trim().toUpperCase();
  if (
    normalized.includes('BYTEA') ||
    normalized.includes('BINARY') ||
    normalized.includes('BLOB')
  ) return 'blob';
  if (normalized.includes('INT') || normalized.includes('SERIAL')) return 'integer';
  if (
    normalized.includes('REAL') ||
    normalized.includes('FLOA') ||
    normalized.includes('DOUB')
  ) return 'real';
  if (
    normalized.includes('NUM') ||
    normalized.includes('DEC') ||
    normalized.includes('MONEY') ||
    normalized.includes('BOOL') ||
    normalized === 'BIT'
  ) return 'numeric';
  return 'text';
}

export function sqlLiteral(
  value: unknown,
  provider: StudioProvider = 'sqlite',
): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') {
    return provider === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be written to SQL.');
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value).toString('hex');
    return provider === 'postgres' ? `'\\\\x${hex}'::bytea` : `X'${hex}'`;
  }
  if (provider === 'mysql') {
    return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqliteLiteral(value: unknown): string {
  return sqlLiteral(value, 'sqlite');
}

type ScanDialect = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

function scanDialect(provider?: StudioProvider): ScanDialect {
  if (provider === 'postgres' || provider === 'mysql') return provider;
  if (
    provider === 'sqlite' ||
    provider === 'turso' ||
    provider === 'd1-local' ||
    provider === 'd1-remote'
  ) return 'sqlite';
  return 'unknown';
}

const dollarTagPattern = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;
const identifierCharPattern = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * Walk SQL text and call `visit` for every character of executable code, i.e.
 * every character outside string literals, quoted identifiers and comments.
 *
 * Dialect-specific syntax is recognised only when the dialect is known:
 * PostgreSQL dollar quotes (`$$ … $$`, `$tag$ … $tag$`), nested block
 * comments and `E'…'` escapes; MySQL `#` comments and backslash escapes;
 * SQLite `[bracketed]` identifiers. With an unknown dialect the scanner stays
 * conservative: it does not hide text behind syntax that the target database
 * might not recognise, so ambiguous input is rejected rather than executed.
 */
function scanSql(
  sql: string,
  provider: StudioProvider | undefined,
  visit: (index: number, char: string) => void,
): { unterminated: boolean } {
  const dialect = scanDialect(provider);
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' |
    'block-comment' | 'dollar' = 'normal';
  let backslashEscapes = false;
  let blockDepth = 0;
  let dollarTag = '';

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        index++;
        blockDepth--;
        if (blockDepth === 0) mode = 'normal';
      } else if (dialect === 'postgres' && char === '/' && next === '*') {
        index++;
        blockDepth++;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (backslashEscapes && char === '\\') {
        index++;
      } else if (char === delimiter) {
        if (next === delimiter) index++;
        else mode = 'normal';
      }
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']') mode = 'normal';
      continue;
    }
    if (mode === 'dollar') {
      if (char === '$' && sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        mode = 'normal';
      }
      continue;
    }

    const previous = index > 0 ? sql[index - 1] : '';
    if (char === '-' && next === '-') {
      index++;
      mode = 'line-comment';
    } else if (char === '#' && dialect === 'mysql') {
      mode = 'line-comment';
    } else if (char === '/' && next === '*') {
      index++;
      blockDepth = 1;
      mode = 'block-comment';
    } else if (char === "'") {
      mode = 'single';
      backslashEscapes = dialect === 'mysql' || (
        dialect === 'postgres' &&
        (previous === 'E' || previous === 'e') &&
        !identifierCharPattern.test(index > 1 ? sql[index - 2] : '')
      );
    } else if (char === '"') {
      mode = 'double';
      backslashEscapes = dialect === 'mysql';
    } else if (char === '`' && dialect !== 'postgres') {
      mode = 'backtick';
      backslashEscapes = false;
    } else if (char === '[' && (dialect === 'sqlite' || dialect === 'unknown')) {
      mode = 'bracket';
    } else if (
      char === '$' &&
      dialect === 'postgres' &&
      !identifierCharPattern.test(previous)
    ) {
      const tag = dollarTagPattern.exec(sql.slice(index, index + 256))?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length - 1;
        mode = 'dollar';
      } else {
        visit(index, char);
      }
    } else {
      visit(index, char);
    }
  }
  return {
    unterminated: mode !== 'normal' && mode !== 'line-comment',
  };
}

/** Replace comments, strings and quoted identifiers with spaces. */
function executableText(sql: string, provider?: StudioProvider): string {
  const code = new Array<string>(sql.length).fill(' ');
  scanSql(sql, provider, (index, char) => { code[index] = char; });
  return code.join('');
}

/** Upper-cased bare words of executable SQL code, in order. */
export function sqlKeywords(sql: string, provider?: StudioProvider): string[] {
  return (executableText(sql, provider).match(/[A-Za-z_][A-Za-z0-9_$]*/g) ?? [])
    .map((word) => word.toUpperCase());
}

const READ_ONLY_LEADING_KEYWORDS = new Set([
  'SELECT', 'WITH', 'VALUES', 'TABLE', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC',
]);
const SCHEMA_RISK_KEYWORDS = new Set([
  'INTO', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'ANALYZE',
]);

/**
 * Whether a console statement may have changed the database schema. Only
 * plain queries and PRAGMA reads are considered safe; everything else,
 * including DDL, writes, `SELECT … INTO`, data-modifying CTEs and PRAGMA
 * writes, invalidates Studio's cached schema.
 */
export function statementMayChangeSchema(statement: string, provider?: StudioProvider): boolean {
  const keywords = sqlKeywords(statement, provider);
  const first = keywords[0];
  if (!first) return false;
  if (first === 'PRAGMA') return /[=(]/.test(executableText(statement, provider));
  if (!READ_ONLY_LEADING_KEYWORDS.has(first)) return true;
  return keywords.some((keyword) => SCHEMA_RISK_KEYWORDS.has(keyword));
}

const ROW_LIMIT_UNSAFE_KEYWORDS = new Set([
  'INTO', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SHARE', 'LOCK',
]);
const ROW_LIMIT_CLAUSE_KEYWORDS = new Set(['LIMIT', 'OFFSET', 'FETCH']);

/** Upper-cased bare words of executable SQL outside parentheses. */
function topLevelKeywords(sql: string, provider?: StudioProvider): string[] {
  const words: string[] = [];
  let depth = 0;
  for (const [token] of executableText(sql, provider).matchAll(/[()]|[A-Za-z_][A-Za-z0-9_$]*/g)) {
    if (token === '(') depth++;
    else if (token === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) words.push(token.toUpperCase());
  }
  return words;
}

/**
 * Bound a SELECT/WITH statement so the database returns at most `limit` rows,
 * instead of materialising the full result in Studio before truncating it.
 * A statement without its own top-level LIMIT, OFFSET or FETCH gets a
 * `LIMIT` appended, which keeps its result columns exactly as written (a
 * derived table renames duplicate columns in SQLite and is rejected by
 * MySQL). Other statements are wrapped as a derived table. Returns
 * `undefined` for statements that cannot be bounded (non-queries,
 * `SELECT … INTO`, data-modifying CTEs, locking reads).
 */
export function limitStatementRows(
  statement: string,
  provider: StudioProvider | undefined,
  limit: number,
): string | undefined {
  const keywords = sqlKeywords(statement, provider);
  if (keywords[0] !== 'SELECT' && keywords[0] !== 'WITH') return undefined;
  if (keywords.some((keyword) => ROW_LIMIT_UNSAFE_KEYWORDS.has(keyword))) return undefined;
  let lastCode = -1;
  scanSql(statement, provider, (index, char) => {
    if (!/\s/.test(char)) lastCode = index;
  });
  const body = (lastCode >= 0 && statement[lastCode] === ';'
    ? statement.slice(0, lastCode) + statement.slice(lastCode + 1)
    : statement).trim();
  // Newlines keep a trailing line comment from swallowing the added clause.
  if (!topLevelKeywords(body, provider).some((keyword) => ROW_LIMIT_CLAUSE_KEYWORDS.has(keyword))) {
    return `${body}\nLIMIT ${limit}`;
  }
  return `SELECT * FROM (\n${body}\n) AS __q LIMIT ${limit}`;
}

interface PlaceholderScan {
  fragments: string[];
  count: number;
}

function scanSqlPlaceholders(sql: string, provider?: StudioProvider): PlaceholderScan {
  const fragments: string[] = [];
  let fragmentStart = 0;
  scanSql(sql, provider, (index, char) => {
    if (char !== '?') return;
    fragments.push(sql.slice(fragmentStart, index));
    fragmentStart = index + 1;
  });
  fragments.push(sql.slice(fragmentStart));
  return { fragments, count: fragments.length - 1 };
}

export function splitSqlParameters(
  sql: string,
  expectedCount: number,
  provider?: StudioProvider,
): string[] {
  const scanned = scanSqlPlaceholders(sql, provider);
  if (scanned.count < expectedCount) throw new Error('Missing SQL parameter.');
  if (scanned.count > expectedCount) throw new Error('Too many SQL parameters.');
  return scanned.fragments;
}

export function interpolateSqlParameters(
  sql: string,
  parameters: readonly unknown[],
  provider: StudioProvider = 'sqlite',
): string {
  const fragments = splitSqlParameters(sql, parameters.length, provider);
  let output = fragments[0];
  for (let index = 0; index < parameters.length; index++) {
    output += sqlLiteral(parameters[index], provider) + fragments[index + 1];
  }
  return output;
}

export function coerceCellValue(
  value: string,
  affinity: ReturnType<typeof sqliteAffinity>,
): string | number {
  if (affinity === 'integer') {
    if (!/^[+-]?\d+$/.test(value.trim())) throw new Error(`Expected an integer, received "${value}".`);
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return value.trim();
    return number;
  }
  if (affinity === 'real' || affinity === 'numeric') {
    const number = Number(value);
    if (!Number.isFinite(number) || value.trim() === '') {
      throw new Error(`Expected a number, received "${value}".`);
    }
    return number;
  }
  return value;
}

/**
 * Return the single executable SQL statement. Semicolons in quoted strings,
 * quoted identifiers, comments and (for PostgreSQL) dollar-quoted bodies are
 * ignored. Pass the provider so dialect-specific syntax is recognised.
 */
export function parseSingleStatement(input: string, provider?: StudioProvider): string {
  let statementEnd = -1;
  let hasCode = false;
  let multiple = false;
  const { unterminated } = scanSql(input, provider, (index, char) => {
    if (char === ';') {
      if (statementEnd === -1 && hasCode) statementEnd = index;
    } else if (!/\s/.test(char)) {
      if (statementEnd !== -1) multiple = true;
      hasCode = true;
    }
  });
  if (multiple) throw new Error('Studio accepts exactly one SQL statement at a time.');
  if (unterminated) {
    throw new Error(
      'SQL contains an unterminated string, identifier, block comment, or dollar-quoted body.',
    );
  }
  if (!hasCode) throw new Error('Enter a non-empty SQL statement.');
  return input.slice(0, statementEnd === -1 ? input.length : statementEnd).trim();
}
