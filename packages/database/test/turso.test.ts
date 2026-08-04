import { describe, expect, it } from 'vitest';
import { turso } from '../src/runtime/deno';

describe('current Turso adapter', () => {
  it('uses @tursodatabase/database for embedded SQL with request scoping', async () => {
    const adapter = await turso({ path: ':memory:' });
    try {
      expect(adapter.scope).toBeDefined();
      await adapter.driver.execute({
        text: 'CREATE TABLE counters (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)',
        parameters: [],
      });
      await adapter.driver.execute({
        text: 'INSERT INTO counters (id, value) VALUES (?, ?)', parameters: [1, 4],
      });
      const result = await adapter.driver.execute<{ value: number }>({
        text: 'SELECT value FROM counters WHERE id = ?', parameters: [1],
      }, 'select');
      expect(result.rows).toEqual([{ value: 4 }]);
    } finally {
      await adapter.driver.close();
    }
  });
});
