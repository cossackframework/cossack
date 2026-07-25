import { describe, expect, it } from 'vitest';
import {
  normalizeQueryResult,
  normalizeValue,
  parseSingleStatement,
  quoteIdentifier,
  interpolateSqlParameters,
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
