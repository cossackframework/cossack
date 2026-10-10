import { expect, it } from 'vitest';
import { verifyAgentReleaseScenario } from './fixtures/agent-release-scenario.js';

const installedRoot = process.env.COSSACK_AGENT_SCENARIO_INSTALLED_ROOT;
it.skipIf(!installedRoot)(
  'composes an inspected tarball app without overwriting edits and reports CLI/MCP metadata and diagnostics consistently',
  async () => {
    const result = await verifyAgentReleaseScenario(installedRoot);
    expect(result.steps).toBe(7);
    expect(result.diagnosticCodes).toContain('COSSACK_ROUTE_TRANSPORT_INVALID');
    expect(result.artifacts.cossack.packagePath).toContain('@file+');
  },
  120000,
);
