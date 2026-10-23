import type { EnvFunction } from '@cossackframework/framework/config';

/** FastDB connection for the CMS. The token is a secret; it never reaches the browser. */
export const requirements = { variables: {
  FASTDB_URL: { type: 'string', required: true, secret: true },
  FASTDB_TOKEN: { type: 'string', required: true, secret: true },
}, bindings: {
  FASTDB_PENDING: { kind: 'object', required: true, runtimes: ['cloudflare'] },
} } as const;

export default ({ env }: { env: EnvFunction }) => ({ url: env('FASTDB_URL') });
