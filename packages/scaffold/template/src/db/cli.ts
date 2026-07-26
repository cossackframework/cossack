import type { DbClient } from '@cossackframework/database';
import { createClient } from './config';

/**
 * Build a Kysely client for Node-only tools such as migrations and seeders.
 *
 * Keeping Wrangler in this CLI-only module prevents Vite's application SSR
 * dependency optimizer from scanning Wrangler and its Node-only dependencies.
 */
export async function getCliClient(): Promise<DbClient> {
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    remoteBindings: false,
  });
  const client = createClient(platform.env);
  const destroyClient = client.destroy.bind(client);
  client.destroy = async () => {
    try {
      await destroyClient();
    } finally {
      await platform.dispose();
    }
  };
  return client;
}
