import { createORM } from '@cossackframework/database';
import { MemoryDriver } from '@cossackframework/database/adapter';
import { describe, expect, it } from 'vitest';
import { createLocalConnection } from '../src/lib/local-connection.js';
import { introspectSchema } from '../src/lib/schema.js';

describe('local connection SQL parameters', () => {
  it.each(['postgres', 'sqlite', 'mysql'] as const)('binds multiple parameters for %s', async (dialect) => {
    const driver = new MemoryDriver(dialect);
    const connection = createLocalConnection({ orm: createORM({ adapter: { driver }, entities: [] }) });
    const parameters = ["Ada's ?", 7, null, new Uint8Array([1, 2])];
    const sql = 'UPDATE people SET name = ?, rank = ?, profile = ? WHERE token = ?';
    try {
      await connection.execute(sql, parameters);
      expect(driver.statements[0]).toEqual({
        operation: 'raw',
        query: {
          text: dialect === 'postgres'
            ? 'UPDATE people SET name = $1, rank = $2, profile = $3 WHERE token = $4'
            : sql,
          parameters,
        },
      });
      expect(driver.statements[0]?.query.parameters).toBe(parameters);
    } finally { await connection.close(); }
  });

  it('ignores question marks in quoted strings, identifiers, and comments', async () => {
    const driver = new MemoryDriver('postgres');
    const connection = createLocalConnection({ orm: createORM({ adapter: { driver }, entities: [] }) });
    try {
      await connection.execute(`SELECT '?', 'it''s ?', "odd?" FROM people /* ? */ WHERE id = ? -- ?\nAND name = ?`, [1, 'Ada']);
      expect(driver.statements[0]?.query.text).toBe(
        `SELECT '?', 'it''s ?', "odd?" FROM people /* ? */ WHERE id = $1 -- ?\nAND name = $2`,
      );
      const raw = `SELECT profile ? 'key' FROM people`;
      await connection.execute(raw);
      expect(driver.statements[1]?.query.text).toBe(raw);
      await expect(connection.execute('SELECT ?, ?', [1])).rejects.toThrow('Too many SQL parameters');
      expect(driver.statements).toHaveLength(2);
    } finally { await connection.close(); }
  });

  it('runs PostgreSQL schema introspection as unparameterized schema-wide catalog queries', async () => {
    const driver = new MemoryDriver('postgres', ({ text }) => {
      if (text.includes('FROM information_schema.tables AS tables')) {
        return { rows: [{ name: 'people', kind: 'table' }, { name: 'teams', kind: 'table' }] };
      }
      if (text.includes('FROM information_schema.columns AS columns')) {
        return {
          rows: [
            { table_name: 'people', name: 'id', data_type: 'integer', nullable: false, primary_key_position: 1 },
            { table_name: 'teams', name: 'slug', data_type: 'text', nullable: false, primary_key_position: 1 },
          ],
        };
      }
      return { rows: [] };
    });
    const connection = createLocalConnection({
      orm: createORM({ adapter: { driver }, entities: [] }),
      info: { provider: 'postgres' },
    });
    try {
      const schema = await introspectSchema(connection, 'test', 'PostgreSQL');
      expect(schema.objects.map((object) => [object.name, object.columns.map((column) => column.name)]))
        .toEqual([['people', ['id']], ['teams', ['slug']]]);
      expect(driver.statements).toHaveLength(4);
      for (const { query } of driver.statements) {
        expect(query.parameters).toEqual([]);
        expect(query.text).not.toMatch(/\?|\$1/);
      }
    } finally { await connection.close(); }
  });
});
