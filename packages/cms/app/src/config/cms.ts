import type { EnvFunction } from '@cossackframework/framework/config';

/**
 * RomeDB connection for the CMS. On Node, ROMEDB_URL defaults to the file
 * storage/romedb/app.romedb, which needs no token. Workers always reach RomeDB over HTTP.
 * Added sites keep their databases beside a main file, or under ROMEDB_SITES_URL (a RomeDB
 * Cloud organization) with an organization key. Tokens are secrets; they never reach the browser.
 */
export const requirements = { variables: {
  ROMEDB_URL: { type: 'string', required: true, secret: true, runtimes: ['cloudflare'] },
  ROMEDB_TOKEN: { type: 'string', required: true, secret: true, runtimes: ['cloudflare'] },
  ROMEDB_SITES_URL: { type: 'string', required: false },
  ROMEDB_SITES_TOKEN: { type: 'string', required: false, secret: true },
}, bindings: {
  ROMEDB_PENDING: { kind: 'object', required: true, runtimes: ['cloudflare'] },
} } as const;

export default ({ env }: { env: EnvFunction }) => ({ url: env('ROMEDB_URL') });
