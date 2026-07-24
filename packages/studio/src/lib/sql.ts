const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(identifier: string): string {
  if (!identifier) throw new Error('Database identifiers cannot be empty.');
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

export function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be written to SQLite.');
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function interpolateSqlParameters(sql: string, parameters: readonly unknown[]): string {
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' =
    'normal';
  let parameterIndex = 0;
  let output = '';

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    output += char;

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        output += next;
        index++;
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (char === delimiter) {
        if (next === delimiter) {
          output += next;
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
      output += next;
      index++;
      mode = 'line-comment';
    } else if (char === '/' && next === '*') {
      output += next;
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
      if (parameterIndex >= parameters.length) throw new Error('Missing SQL parameter.');
      output = output.slice(0, -1) + sqliteLiteral(parameters[parameterIndex++]);
    }
  }
  if (parameterIndex !== parameters.length) throw new Error('Too many SQL parameters.');
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
