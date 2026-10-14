import type { StudioConnection, StudioQueryResult, StudioStatement } from './schema-types.js';

/**
 * Upper bounds for one `StudioConnection.batch()` call. Remote D1 sends a
 * batch as one Wrangler command-line argument, so the character budget stays
 * well below the 32,767-character Windows command line.
 */
export const MAX_BATCH_STATEMENTS = 50;
export const MAX_BATCH_CHARACTERS = 16_000;

/** Split statements into batches within the statement and character limits. */
export function chunkStatements<T extends StudioStatement>(
  statements: readonly T[],
  maxStatements = MAX_BATCH_STATEMENTS,
  maxCharacters = MAX_BATCH_CHARACTERS,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let characters = 0;
  for (const statement of statements) {
    const size = statement.sql.length + 3;
    if (current.length && (current.length >= maxStatements || characters + size > maxCharacters)) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(statement);
    characters += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Run statements in order: in as few batches as the connection allows, or
 * one by one when it has no `batch()`. Rejects on the first failure.
 */
export async function runStatements(
  connection: StudioConnection,
  statements: readonly StudioStatement[],
): Promise<StudioQueryResult[]> {
  const results: StudioQueryResult[] = [];
  if (!connection.batch) {
    for (const statement of statements) {
      results.push(await connection.execute(statement.sql, statement.parameters));
    }
    return results;
  }
  for (const chunk of chunkStatements(statements)) {
    results.push(...await connection.batch(chunk));
  }
  return results;
}
