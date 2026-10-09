import { expect, it } from 'vitest';
import { verifyBackgroundReleaseScenario } from './fixtures/background-release-scenario.js';
const installedRoot = process.env.COSSACK_BACKGROUND_SCENARIO_INSTALLED_ROOT;
it.skipIf(!installedRoot)(
  'returns before native background retry, records truthful notification outcomes, respects changed preferences and releases consumer facilities',
  async () => {
    const result = await verifyBackgroundReleaseScenario(installedRoot);
    expect(result.snapshots).toHaveLength(2);
    expect(result.envelopes).toHaveLength(4);
    expect(result.rejectedNonSerializableInputs).toBe(3);
  },
  240000,
);
