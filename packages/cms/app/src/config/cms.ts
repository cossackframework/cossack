import type { EnvFunction } from '@cossackframework/framework/config';

/** RomeDB connection for the CMS. The token is a secret; it never reaches the browser. */
export const requirements = { variables: {
  ROMEDB_URL: { type: 'string', required: true, secret: true },
  ROMEDB_TOKEN: { type: 'string', required: true, secret: true },
}, bindings: {
  ROMEDB_PENDING: { kind: 'object', required: true, runtimes: ['cloudflare'] },
} } as const;

export default ({ env }: { env: EnvFunction }) => ({ url: env('ROMEDB_URL') });
