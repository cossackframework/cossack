import { expect, it } from 'vitest';
import { verifyProtectedResourceScenario } from './fixtures/protected-resource-scenario.js';

it.skipIf(!process.env.COSSACK_SCENARIO_INSTALLED_ROOT)(
  'composes a protected typed resource, URL filter and validated durable edit without granting forged RPC authority',
  async () => {
    const proof = await verifyProtectedResourceScenario(process.env.COSSACK_SCENARIO_INSTALLED_ROOT);
    expect(proof).toMatchObject({
      installed: true,
      protectedTypedQuery: true,
      urlFilters: true,
      serverFieldErrorPreservesInput: true,
      successfulDurableEdit: true,
      directUnauthorizedSameEditRejected: true,
    });
    console.log(`Protected resource scenario evidence: ${proof.root}`);
  },
  240000,
);
