import { it, expect } from 'vitest';
import { verifyDenoDeployHosted } from './fixtures/deno-deploy-hosted-acceptance.js';

const mode = process.env.COSSACK_DENO_HOSTED_MODE;
it.skipIf(!mode)(
  'prepares installed Deno artifacts and optionally verifies real Deploy HTTP/SSE/WebSocket acceptance',
  async () => {
    expect(['prepare', 'deploy']).toContain(mode);
    const result = await verifyDenoDeployHosted({
      installedRoot: process.env.COSSACK_DENO_HOSTED_INSTALLED_ROOT,
      binary: process.env.COSSACK_DENO_BINARY,
      deploy: mode === 'deploy',
      preparedUpload: process.env.COSSACK_DENO_HOSTED_PREPARED_UPLOAD,
    });
    expect(result.prepared).toBe(true);
    expect(result.hosted).toBe(mode === 'deploy');
    console.log('Private Deno acceptance evidence:', result.evidence);
  },
  600000,
);
