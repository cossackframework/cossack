/** Node-only verification of explicitly budgeted auxiliary build artifacts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readAuxiliaryBuildBudgets, type AuxiliaryBuildBudget } from './auxiliary-build-budgets.js';
import { readCloudflareDeclarationConfig } from './config-preflight.js';
import { inspectDeploymentArtifact, DeploymentError } from './deployment-artifact.js';
import { checkBuildBudgets, type BudgetToolOptions, type BudgetToolRunner } from './build-budgets.js';
export { readAuxiliaryBuildBudgets } from './auxiliary-build-budgets.js';
export interface AuxiliaryBudgetTarget { policy: AuxiliaryBuildBudget; expected: Record<string, any>; }
const fail = (code: string, message: string): never => { throw new DeploymentError(code, message); };
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
async function regular(root: string, file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || !inside(await fs.realpath(root), await fs.realpath(file))) {
    fail('COSSACK_AUXILIARY_BUILD_ARTIFACT_INVALID', 'Auxiliary Worker configuration must be a regular project file.');
  }
}
/** Capture source targets before building without evaluating application config. */
export async function prepareAuxiliaryBudgetTargets(root: string, policies: AuxiliaryBuildBudget[], environment?: string): Promise<AuxiliaryBudgetTarget[]> {
  const result = [];
  try {
    for (const policy of policies) {
      const source = path.resolve(root, policy.configPath);
      await regular(root, source);
      const expected = await readCloudflareDeclarationConfig(root, source, environment);
      result.push({ policy, expected });
    }
    return result;
  } catch { return fail('COSSACK_AUXILIARY_BUILD_SOURCE_INVALID', 'Cannot validate an auxiliary Worker source configuration for the selected environment.'); }
}
/** Reject changed policies/source targets before trusting artifact measurements. */
export async function assertAuxiliaryBudgetTargets(root: string, targets: AuxiliaryBudgetTarget[], environment?: string) {
  if (!isDeepStrictEqual(await readAuxiliaryBuildBudgets(root), targets.map(target => target.policy))) {
    fail('COSSACK_AUXILIARY_BUILD_BUDGET_SETTINGS_CHANGED', 'Auxiliary Worker budget settings changed during the build. Run the build again.');
  }
  for (const target of targets) {
    try {
      const source = path.resolve(root, target.policy.configPath);
      await regular(root, source);
      if (!isDeepStrictEqual(await readCloudflareDeclarationConfig(root, source, environment), target.expected)) throw new Error();
    } catch { fail('COSSACK_AUXILIARY_BUILD_SOURCE_CHANGED', 'An auxiliary Worker source target changed during the build. Run the build again.'); }
  }
}
/** Match exact source identities, then verify every selected artifact before returning any. */
export async function inspectAuxiliaryBudgetArtifacts(root: string, targets: AuxiliaryBudgetTarget[], environment?: string) {
  await assertAuxiliaryBudgetTargets(root, targets, environment);
  if (!targets.length) return [];
  try {
    const redirectPath = path.join(root, '.wrangler/deploy/config.json');
    await regular(root, redirectPath);
    const redirect = JSON.parse(await fs.readFile(redirectPath, 'utf8'));
    if (!Array.isArray(redirect.auxiliaryWorkers) || redirect.auxiliaryWorkers.length > 32) throw new Error();
    const candidates: { artifact: string; source: string }[] = [];
    const seen = new Set<string>();
    const primary = typeof redirect.configPath === 'string' ? path.resolve(path.dirname(redirectPath), redirect.configPath) : undefined;
    const prerender = typeof redirect.prerenderWorkerConfigPath === 'string' ? path.resolve(path.dirname(redirectPath), redirect.prerenderWorkerConfigPath) : undefined;
    for (const entry of redirect.auxiliaryWorkers) {
      if (!entry || typeof entry.configPath !== 'string') throw new Error();
      const artifact = path.resolve(path.dirname(redirectPath), entry.configPath);
      await regular(root, artifact);
      const identity = await fs.realpath(artifact);
      if (seen.has(identity) || artifact === primary || artifact === prerender) throw new Error();
      seen.add(identity);
      const config = JSON.parse(await fs.readFile(artifact, 'utf8'));
      if (typeof config.configPath !== 'string' || !path.isAbsolute(config.configPath)) throw new Error();
      candidates.push({ artifact, source: config.configPath });
    }
    const result = [];
    for (const target of targets) {
      const matched = candidates.filter(candidate => candidate.source === path.resolve(root, target.policy.configPath));
      if (matched.length !== 1) throw new Error();
      await inspectDeploymentArtifact(root, matched[0].artifact, target.expected, false);
      result.push({ ...target, artifact: matched[0].artifact });
    }
    return result;
  } catch { return fail('COSSACK_AUXILIARY_BUILD_ARTIFACT_INVALID', 'Auxiliary deployment metadata must identify exactly one matching built Worker for each policy. Check the Cloudflare Vite configuration.'); }
}
/** Local validation only. This does not upload auxiliary Workers. */
export async function checkAuxiliaryBuildBudgets(root: string, targets: AuxiliaryBudgetTarget[], environment?: string,
  options: BudgetToolOptions & { run?: BudgetToolRunner } = {}) {
  const artifacts = await inspectAuxiliaryBudgetArtifacts(root, targets, environment);
  const workers = [];
  for (const target of artifacts) {
    workers.push({ configPath: target.policy.configPath, buildBudgets: await checkBuildBudgets(root, target.artifact, target.policy.budgets, options) });
  }
  // Measurement can execute application initialization; revalidate before returning.
  await inspectAuxiliaryBudgetArtifacts(root, targets, environment);
  const diagnostics = workers.flatMap(worker => worker.buildBudgets.diagnostics);
  return { workers, diagnostics, valid: workers.every(worker => worker.buildBudgets.valid) };
}
