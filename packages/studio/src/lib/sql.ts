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

interface PlaceholderScan {
  fragments: string[];
  count: number;
}

function scanSqlPlaceholders(sql: string): PlaceholderScan {
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' =
    'normal';
  const fragments: string[] = [];
  let fragmentStart = 0;

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
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (char === delimiter) {
        if (next === delimiter) {
          index++;
        } else {
          mode = 'normal';
        }
      }
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']') mode = 'normal';
      continue;
    }
    if (char === '-' && next === '-') {
      index++;
      mode = 'line-comment';
    } else if (char === '/' && next === '*') {
      index++;
      mode = 'block-comment';
    } else if (char === "'") {
      mode = 'single';
    } else if (char === '"') {
      mode = 'double';
    } else if (char === '`') {
      mode = 'backtick';
    } else if (char === '[') {
      mode = 'bracket';
    } else if (char === '?') {
      fragments.push(sql.slice(fragmentStart, index));
      fragmentStart = index + 1;
    }
  }
  fragments.push(sql.slice(fragmentStart));
  return { fragments, count: fragments.length - 1 };
}

export function splitSqlParameters(sql: string, expectedCount: number): string[] {
  const scanned = scanSqlPlaceholders(sql);
  if (scanned.count < expectedCount) throw new Error('Missing SQL parameter.');
  if (scanned.count > expectedCount) throw new Error('Too many SQL parameters.');
  return scanned.fragments;
}

export function interpolateSqlParameters(
  sql: string,
  parameters: readonly unknown[],
  provider: StudioProvider = 'sqlite',
): string {
  const fragments = splitSqlParameters(sql, parameters.length);
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
 * quoted identifiers, bracketed identifiers, and comments are ignored.
 */
export function parseSingleStatement(input: string): string {
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' =
    'normal';
  let statementEnd = -1;
  let hasCode = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (mode === 'line-comment') {
      if (char === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'normal';
        index++;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (char === delimiter) {
        if (next === delimiter) index++;
        else mode = 'normal';
      }
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']') mode = 'normal';
      continue;
    }
    if (char === '-' && next === '-') {
      mode = 'line-comment';
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment';
      index++;
      continue;
    }
    if (char === "'") mode = 'single';
    else if (char === '"') mode = 'double';
    else if (char === '`') mode = 'backtick';
    else if (char === '[') mode = 'bracket';
    else if (char === ';') {
      if (statementEnd === -1 && hasCode) statementEnd = index;
    } else if (!/\s/.test(char)) {
      if (statementEnd !== -1) {
        throw new Error('Studio accepts exactly one SQL statement at a time.');
      }
      hasCode = true;
    }
  }

  if (mode === 'single' || mode === 'double' || mode === 'backtick' ||
      mode === 'bracket' || mode === 'block-comment') {
    throw new Error('SQL contains an unterminated string, identifier, or block comment.');
  }
  if (!hasCode) throw new Error('Enter a non-empty SQL statement.');
  return input.slice(0, statementEnd === -1 ? input.length : statementEnd).trim();
}
