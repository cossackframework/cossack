import { it, expect } from 'vitest';
import { verifyRealtimeReleaseScenario } from './fixtures/realtime-release-scenario.js';

it.skipIf(!process.env.COSSACK_REALTIME_SCENARIO_INSTALLED_ROOT)(
  'composes permitted concurrent editors, two native Workers, disconnect outcomes and a subscribed private-scope observer',
  async () => {
    const result = await verifyRealtimeReleaseScenario({
      installedRoot: process.env.COSSACK_REALTIME_SCENARIO_INSTALLED_ROOT,
    });
    expect(result.completed).toBe(true);
    console.log(`Installed realtime scenario evidence: ${result.evidence}`);
  },
  180000,
);
