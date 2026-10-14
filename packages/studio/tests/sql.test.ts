import { describe, expect, it } from 'vitest';
import {
  normalizeQueryResult,
  normalizeValue,
  parseSingleStatement,
  quoteIdentifier,
  interpolateSqlParameters,
  limitStatementRows,
  splitSqlParameters,
  sqliteAffinity,
  sqliteDeclaredKind,
  sqliteLiteral,
  sqlLiteral,
} from '../src/testing';

describe('single-statement SQL parsing', () => {
  it('accepts one statement and ignores semicolons in strings and comments', () => {
    expect(parseSingleStatement("SELECT ';' AS value; -- trailing ;\n")).toBe("SELECT ';' AS value");
    expect(parseSingleStatement('/* ; */ SELECT "a;b"')).toBe('/* ; */ SELECT "a;b"');
  });

  it('rejects empty, multiple, and unterminated statements', () => {
    expect(() => parseSingleStatement(' -- comment only')).toThrow('non-empty');
    expect(() => parseSingleStatement('SELECT 1; SELECT 2')).toThrow('exactly one');
    expect(() => parseSingleStatement("SELECT 'oops")).toThrow('unterminated');
  });

  it('accepts PostgreSQL dollar-quoted bodies containing semicolons', () => {
    const fn = `CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;`;
    expect(parseSingleStatement(fn, 'postgres')).toBe(fn.slice(0, -1));
    const tagged = `DO $body$ BEGIN PERFORM 1; RAISE NOTICE '$$'; END $body$`;
    expect(parseSingleStatement(tagged, 'postgres')).toBe(tagged);
    expect(parseSingleStatement('SELECT $1, a$b$ FROM t', 'postgres')).toBe('SELECT $1, a$b$ FROM t');
    expect(() => parseSingleStatement('SELECT $x$ unterminated;', 'postgres'))
      .toThrow('unterminated');
    expect(() => parseSingleStatement('SELECT 1; SELECT $$;$$', 'postgres')).toThrow('exactly one');
    // Dollar quotes are PostgreSQL-only; elsewhere the scanner stays conservative.
    expect(() => parseSingleStatement('SELECT $$ a; b $$', 'sqlite')).toThrow('exactly one');
    expect(() => parseSingleStatement('SELECT $$ a; b $$')).toThrow('exactly one');
  });

  it('treats # as a line comment only for MySQL', () => {
    expect(parseSingleStatement('SELECT 1; # trailing ; comment\n', 'mysql')).toBe('SELECT 1');
    expect(parseSingleStatement('# leading; comment\nSELECT 1', 'mysql'))
      .toBe('# leading; comment\nSELECT 1');
    expect(() => parseSingleStatement('# only a comment', 'mysql')).toThrow('non-empty');
    expect(() => parseSingleStatement('SELECT 1; # x', 'sqlite')).toThrow('exactly one');
  });

  it('honours MySQL backslash escapes and PostgreSQL E-strings', () => {
    expect(parseSingleStatement("SELECT 'it\\'s; fine'", 'mysql')).toBe("SELECT 'it\\'s; fine'");
    expect(parseSingleStatement("SELECT E'it\\'s; fine'", 'postgres'))
      .toBe("SELECT E'it\\'s; fine'");
  });
});

describe('dialect-aware placeholder scanning', () => {
  it('ignores placeholders inside PostgreSQL dollar quotes', () => {
    expect(splitSqlParameters('SELECT $$?$$, $tag$ ? $tag$, ?', 1, 'postgres'))
      .toEqual(['SELECT $$?$$, $tag$ ? $tag$, ', '']);
  });

  it('ignores placeholders inside MySQL # comments', () => {
    expect(interpolateSqlParameters('SELECT ? # what?\n', [1], 'mysql'))
      .toBe('SELECT 1 # what?\n');
  });
});

describe('console row limiting', () => {
  it('appends a LIMIT to queries without their own row-limiting clause', () => {
    expect(limitStatementRows('SELECT * FROM t;', 'sqlite', 1001))
      .toBe('SELECT * FROM t\nLIMIT 1001');
    expect(limitStatementRows('/* c */ with x as (select 1 limit 1) select * from x -- tail', 'postgres', 5))
      .toBe('/* c */ with x as (select 1 limit 1) select * from x -- tail\nLIMIT 5');
    expect(limitStatementRows("SELECT 'LIMIT 3' AS `offset` FROM a UNION SELECT b FROM c ORDER BY 1", 'mysql', 5))
      .toBe("SELECT 'LIMIT 3' AS `offset` FROM a UNION SELECT b FROM c ORDER BY 1\nLIMIT 5");
  });

  it('wraps queries that already limit, offset or fetch rows in a bounded outer query', () => {
    expect(limitStatementRows('SELECT * FROM t LIMIT 5000', 'sqlite', 1001))
      .toBe('SELECT * FROM (\nSELECT * FROM t LIMIT 5000\n) AS __q LIMIT 1001');
    expect(limitStatementRows('SELECT * FROM t OFFSET 10', 'postgres', 5))
      .toBe('SELECT * FROM (\nSELECT * FROM t OFFSET 10\n) AS __q LIMIT 5');
    expect(limitStatementRows('SELECT * FROM t FETCH FIRST 9 ROWS ONLY', 'postgres', 5))
      .toBe('SELECT * FROM (\nSELECT * FROM t FETCH FIRST 9 ROWS ONLY\n) AS __q LIMIT 5');
  });

  it('leaves non-query and table-creating statements untouched', () => {
    for (const statement of [
      'INSERT INTO t VALUES (1)',
      'PRAGMA table_info(t)',
      'SELECT * INTO copy FROM t',
      'WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone',
      'SELECT * FROM t FOR UPDATE',
      'EXPLAIN SELECT 1',
    ]) {
      expect(limitStatementRows(statement, 'postgres', 10)).toBeUndefined();
    }
  });
});

describe('SQLite values and identifiers', () => {
  it('quotes identifiers and literals without interpolation vulnerabilities', () => {
    expect(quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(sqliteLiteral("a'b")).toBe("'a''b'");
    expect(sqliteLiteral(new Uint8Array([0, 255]))).toBe("X'00ff'");
    expect(quoteIdentifier('odd`name', 'mysql')).toBe('`odd``name`');
    expect(sqlLiteral(true, 'postgres')).toBe('TRUE');
    expect(sqlLiteral(new Uint8Array([0, 255]), 'postgres')).toBe("'\\\\x00ff'::bytea");
  });

  it('uses SQLite type affinity rules', () => {
    expect(sqliteAffinity('BIGINT')).toBe('integer');
    expect(sqliteAffinity('varchar(20)')).toBe('text');
    expect(sqliteAffinity('double precision')).toBe('real');
    expect(sqliteAffinity('')).toBe('blob');
    expect(sqliteAffinity('decimal(10,2)')).toBe('numeric');
  });

  it('classifies declared editor types independently from SQLite affinity', () => {
    expect(sqliteDeclaredKind('VARCHAR(100)')).toBe('varchar');
    expect(sqliteDeclaredKind('TEXT')).toBe('text');
    expect(sqliteDeclaredKind('JSON')).toBe('json');
    expect(sqliteDeclaredKind('DATETIME')).toBe('datetime');
    expect(sqliteDeclaredKind('INTEGER')).toBe('number');
  });

  it('interpolates only placeholders outside strings, identifiers, and comments', () => {
    expect(interpolateSqlParameters(
      `SELECT "odd?", '?', [also?] FROM "table?" WHERE id = ? -- ?\n`,
      [7],
    )).toBe(`SELECT "odd?", '?', [also?] FROM "table?" WHERE id = 7 -- ?\n`);
  });
});

describe('transport normalization', () => {
  it('tags values that JSON cannot safely preserve', () => {
    expect(normalizeValue(12n)).toEqual({ $type: 'bigint', value: '12' });
    expect(normalizeValue(new Date('2026-01-02T03:04:05Z'))).toEqual({
      $type: 'date',
      value: '2026-01-02T03:04:05.000Z',
    });
    expect(normalizeValue(new Uint8Array([1, 2, 3]))).toEqual({
      $type: 'blob',
      value: 'AQID',
    });
  });

  it('caps result rows and reports truncation', () => {
    const result = normalizeQueryResult({
      rows: [{ id: 1 }, { id: 2 }],
      affectedRows: 0,
      durationMs: 1,
    }, 1);
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.truncated).toBe(true);
  });
});
