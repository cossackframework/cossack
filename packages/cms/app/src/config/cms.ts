import type { EnvFunction } from '@cossackframework/framework/config';

/**
 * RomeDB connection for the CMS. On Node, ROMEDB_URL defaults to the file
 * storage/romedb/app.romedb, which needs no token. Workers always reach RomeDB over HTTP.
 * The token is a secret; it never reaches the browser.
 */
export const requirements = { variables: {
  ROMEDB_URL: { type: 'string', required: true, secret: true, runtimes: ['cloudflare'] },
  ROMEDB_TOKEN: { type: 'string', required: true, secret: true, runtimes: ['cloudflare'] },
}, bindings: {
  ROMEDB_PENDING: { kind: 'object', required: true, runtimes: ['cloudflare'] },
} } as const;

export default ({ env }: { env: EnvFunction }) => ({ url: env('ROMEDB_URL') });
