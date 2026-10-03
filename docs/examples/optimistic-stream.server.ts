import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { sql } from '@cossackframework/database';

// Install the auth and database recipes before using this request-owned store.
function ownerId(): string {
    const user = getRequestContext()?.get('user') as { id: string } | undefined;
    if (!user?.id) throw new ClientVisibleError('Sign in before reading or changing the counter.');
    return user.id;
}

async function ensure(id: string): Promise<void> {
    // A real application should create this table through a migration.
    await sql`CREATE TABLE IF NOT EXISTS optimistic_example_counter (id TEXT PRIMARY KEY, count INTEGER NOT NULL)`;
    await sql`INSERT OR IGNORE INTO optimistic_example_counter VALUES (${id}, 0)`;
}

export async function readCounter(): Promise<{ count: number }> {
    const id = ownerId();
    await ensure(id);
    const result = await sql<{ count: number }>`SELECT count FROM optimistic_example_counter WHERE id = ${id}`;
    return result.rows[0]!;
}

export async function incrementCounter(): Promise<{ count: number }> {
    const id = ownerId();
    await ensure(id);
    const result = await sql<{ count: number }>`UPDATE optimistic_example_counter SET count = count + 1 WHERE id = ${id} RETURNING count`;
    return result.rows[0]!;
}
