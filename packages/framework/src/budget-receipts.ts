/** Node-only, invocation-bound budget results. Never persist the signing key or tool output. */
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { checkBuildBudgets, evaluateBuildBudgets, readBuildBudgets, type BuildBudgets } from './build-budgets.js';
import { fingerprintBudgetInventory } from './budget-inventory.js';
import { assertAuxiliaryBudgetTargets, inspectAuxiliaryBudgetArtifacts, type AuxiliaryBudgetTarget } from './auxiliary-deployment.js';
import { budgetHash as hash, validBudgetKey, writeSignedBudgetReceipt, readSignedBudgetReceipt } from './budget-receipt-store.js';
export { BUDGET_RUN_ENV, clearBudgetReceipt, prepareBudgetRun } from './budget-receipt-store.js';
type BudgetResult = Awaited<ReturnType<typeof checkBuildBudgets>>;
const settings = (budgets: BuildBudgets) => JSON.stringify(Object.entries(budgets).sort(([a], [b]) => a.localeCompare(b)).map(([metric, limits]) => [metric, { warning: limits.warning, error: limits.error }]));
const selected = (environment?: string) => environment || null;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
export type BudgetBatchResult = {
  primary: BudgetResult;
  auxiliary: { workers: { configPath: string; buildBudgets: BudgetResult }[]; diagnostics: BudgetResult['diagnostics']; valid: boolean };
};

async function readReceiptFile(file: string) {
  if (await realpath(file) !== path.resolve(file)) return;
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > 1024 * 1024) return;
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1024 * 1024) return;
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally { await handle.close(); }
}

export async function assertBudgetSettings(root: string, budgets: BuildBudgets) {
  if (settings(await readBuildBudgets(root)) !== settings(budgets)) throw failure('COSSACK_BUILD_BUDGET_SETTINGS_CHANGED', 'Build budgets changed during the build. Rebuild with the current settings.');
}

/** Conservative no-bundle module inventory; unsupported graphs must be measured again. */
export async function fingerprintBudgetArtifact(root: string, artifact: string, budgets: BuildBudgets, environment?: string): Promise<string | undefined> {
  try {
    const redirectFile = path.join(root, '.wrangler/deploy/config.json');
    if (await realpath(redirectFile) !== path.resolve(redirectFile)) return;
    const redirectStat = await lstat(redirectFile);
    if (!redirectStat.isFile() || redirectStat.isSymbolicLink() || redirectStat.size > 1024 * 1024) return;
    const handle = await open(redirectFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let text: string;
    try {
      const stat = await handle.stat();
      const maximum = 1024 * 1024;
      if (!stat.isFile() || stat.size > maximum) return;
      const buffer = Buffer.alloc(maximum + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maximum) return;
      text = buffer.subarray(0, length).toString('utf8');
    } finally { await handle.close(); }
    const redirect = JSON.parse(text);
    if (typeof redirect.configPath !== 'string' || path.resolve(path.dirname(redirectFile), redirect.configPath) !== path.resolve(artifact) || (redirect.auxiliaryWorkers?.length ?? 0) !== 0) return;
    return fingerprintBudgetInventory(root, [artifact], [redirectFile], JSON.stringify({ settings: settings(budgets), environment: selected(environment) }),
      Object.keys(budgets).some(metric => metric === 'localStartupProfileMs' || metric === 'localStartupActiveMs'));
  } catch { return undefined; }
}

/** Sign only safe metrics; before/after identity prevents caching changed artifacts. */
export async function writeBudgetReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string | undefined, before: string | undefined, result: BudgetResult) {
  if (!key || !validBudgetKey(key) || !before || before !== await fingerprintBudgetArtifact(root, artifact, budgets, environment)) return false;
  const values: Record<string, number> = {};
  for (const measurement of result.measurements) if ('value' in measurement && typeof measurement.value === 'number') values[measurement.metric] = measurement.value;
  const sizeMetrics = ['uploadKiB', 'gzipUploadKiB'].filter(metric => Object.hasOwn(budgets, metric));
  if (sizeMetrics.some(metric => Object.hasOwn(values, metric)) && sizeMetrics.some(metric => !Object.hasOwn(values, metric))) return false;
  const body = { version: 1, run: hash(key), settings: hash(settings(budgets)), environment: selected(environment), fingerprint: before,
    outcome: result.diagnostics.some(item => item.code === 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED') ? 'failed' : 'measured', values };
  await writeSignedBudgetReceipt(root, key, body);
  return true;
}
export async function readBudgetReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string): Promise<BudgetResult | undefined> {
  await assertBudgetSettings(root, budgets);
  try {
    const body = await readSignedBudgetReceipt(root, key, 1);
    if (!body || body.settings !== hash(settings(budgets)) || body.environment !== selected(environment) || typeof body.fingerprint !== 'string' || !/^[a-f\d]{64}$/.test(body.fingerprint)) return;
    const fingerprint = await fingerprintBudgetArtifact(root, artifact, budgets, environment);
    if (!fingerprint || body.fingerprint !== fingerprint) return;
    if (body.outcome === 'failed') return { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error', message: 'Local Wrangler artifact measurement failed; no configured budget was verified.' }] };
    if (body.outcome !== 'measured' || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) return;
    for (const [metric, value] of Object.entries(body.values)) if (!Object.hasOwn(budgets, metric) || !['uploadKiB', 'gzipUploadKiB', 'localStartupProfileMs', 'localStartupActiveMs'].includes(metric) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    const values = body.values;
    const sizeMetrics = ['uploadKiB', 'gzipUploadKiB'].filter(metric => Object.hasOwn(budgets, metric));
    if (sizeMetrics.some(metric => Object.hasOwn(values, metric)) && sizeMetrics.some(metric => !Object.hasOwn(values, metric))) return;
    // An unconfigured counterpart is immaterial to evaluation; never expose it as a measurement.
    return evaluateBuildBudgets(budgets, (values.uploadKiB !== undefined || values.gzipUploadKiB !== undefined) ? `Total Upload: ${(values.uploadKiB ?? 0).toFixed(2)} KiB / gzip: ${(values.gzipUploadKiB ?? 0).toFixed(2)} KiB` : '', { localStartupProfileMs: values.localStartupProfileMs, localStartupActiveMs: values.localStartupActiveMs });
  } catch { return undefined; }
}


/** One identity for every measured Worker. Unselected auxiliary graphs decline reuse. */
export async function fingerprintBudgetBatch(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  targets: AuxiliaryBudgetTarget[]): Promise<string | undefined> {
  try {
    await assertBudgetSettings(root, budgets);
    const redirectFile = path.join(root, '.wrangler/deploy/config.json');
    const redirect = await readReceiptFile(redirectFile);
    if (!redirect || typeof redirect.configPath !== 'string' || path.resolve(path.dirname(redirectFile), redirect.configPath) !== path.resolve(artifact)) return;
    const entries = redirect.auxiliaryWorkers ?? [];
    if (!Array.isArray(entries) || entries.length !== targets.length || entries.length > 32) return;
    const auxiliary = await inspectAuxiliaryBudgetArtifacts(root, targets, environment);
    const artifacts = [artifact, ...auxiliary.map(target => target.artifact)];
    if (redirect.prerenderWorkerConfigPath !== undefined) {
      if (typeof redirect.prerenderWorkerConfigPath !== 'string') return;
      artifacts.push(path.resolve(path.dirname(redirectFile), redirect.prerenderWorkerConfigPath));
    }
    if (new Set(artifacts.map(file => path.resolve(file))).size !== artifacts.length) return;
    const sources = [redirectFile];
    for (const file of artifacts) {
      const config = await readReceiptFile(file);
      if (!config || typeof config.configPath !== 'string' || !path.isAbsolute(config.configPath)) return;
      sources.push(config.configPath);
    }
    const context = JSON.stringify({ version: 2, settings: settings(budgets), environment: selected(environment),
      targets: targets.map(target => ({ path: target.policy.configPath, settings: settings(target.policy.budgets),
        // Wrangler records explicit default selection as an empty string in Vite,
        // and omitted default selection as undefined in the CLI. Both select the
        // same source environment, already bound independently in this context.
        expected: { ...target.expected, targetEnvironment: selected(environment) } })), artifacts });
    const startup = [budgets, ...targets.map(target => target.policy.budgets)].some(policy =>
      Object.keys(policy).some(metric => metric === 'localStartupProfileMs' || metric === 'localStartupActiveMs'));
    return fingerprintBudgetInventory(root, artifacts, sources, context, startup);
  } catch { return undefined; }
}

type SafeResult = { outcome: 'failed' | 'measured'; values: Record<string, number> };
const batchSettings = (budgets: BuildBudgets, targets: AuxiliaryBudgetTarget[]) => hash(JSON.stringify([
  settings(budgets), targets.map(target => [target.policy.configPath, settings(target.policy.budgets)])]));
function restoreBudgetResult(budgets: BuildBudgets, stored: unknown): BudgetResult | undefined {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
  const body = stored as SafeResult;
  if (Object.keys(body).some(key => !['outcome', 'values'].includes(key)) || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) return;
  if (body.outcome === 'failed') {
    if (Object.keys(body.values).length) return;
    return { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error',
      message: 'Local Wrangler artifact measurement failed; no configured budget was verified.' }] };
  }
  if (body.outcome !== 'measured') return;
  for (const [metric, value] of Object.entries(body.values)) {
    if (!Object.hasOwn(budgets, metric) || !['uploadKiB', 'gzipUploadKiB', 'localStartupProfileMs', 'localStartupActiveMs'].includes(metric) ||
      typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
  }
  const sizes = ['uploadKiB', 'gzipUploadKiB'].filter(metric => Object.hasOwn(budgets, metric));
  if (sizes.some(metric => Object.hasOwn(body.values, metric)) && sizes.some(metric => !Object.hasOwn(body.values, metric))) return;
  const values = body.values;
  return evaluateBuildBudgets(budgets, values.uploadKiB !== undefined || values.gzipUploadKiB !== undefined
    ? `Total Upload: ${(values.uploadKiB ?? 0).toFixed(2)} KiB / gzip: ${(values.gzipUploadKiB ?? 0).toFixed(2)} KiB` : '',
  { localStartupProfileMs: values.localStartupProfileMs, localStartupActiveMs: values.localStartupActiveMs });
}
function storeBudgetResult(budgets: BuildBudgets, result: BudgetResult): SafeResult | undefined {
  const values: Record<string, number> = {};
  for (const measurement of result.measurements) {
    if ('value' in measurement) {
      if (typeof measurement.value !== 'number' || !Number.isFinite(measurement.value) || measurement.value < 0 || Object.hasOwn(values, measurement.metric)) return;
      values[measurement.metric] = measurement.value;
    }
  }
  const outcome = result.diagnostics.some(item => item.code === 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED') ? 'failed' : 'measured';
  const stored: SafeResult = { outcome, values };
  const restored = restoreBudgetResult(budgets, stored);
  if (!restored || restored.valid !== result.valid || JSON.stringify(restored.diagnostics.map(item => [item.code, item.severity])) !==
    JSON.stringify(result.diagnostics.map(item => [item.code, item.severity]))) return;
  return stored;
}

/** Write only a complete batch after its entire identity remains unchanged. */
export async function writeBudgetBatchReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string | undefined, before: string | undefined, batch: BudgetBatchResult, targets: AuxiliaryBudgetTarget[]) {
  if (!key || !validBudgetKey(key) || !before || batch.auxiliary.workers.length !== targets.length) return false;
  const primary = storeBudgetResult(budgets, batch.primary);
  const workers = targets.map((target, index) => batch.auxiliary.workers[index].configPath === target.policy.configPath
    ? storeBudgetResult(target.policy.budgets, batch.auxiliary.workers[index].buildBudgets) : undefined);
  if (!primary || workers.some(worker => !worker) || before !== await fingerprintBudgetBatch(root, artifact, budgets, environment, targets)) return false;
  await writeSignedBudgetReceipt(root, key, { version: 2, run: hash(key), settings: batchSettings(budgets, targets), environment: selected(environment),
    fingerprint: before, primary, workers });
  return true;
}

/** Reconstruct diagnostics from current policies, never from stored tool output. */
export async function readBudgetBatchReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string, targets: AuxiliaryBudgetTarget[]): Promise<BudgetBatchResult | undefined> {
  await assertBudgetSettings(root, budgets);
  await assertAuxiliaryBudgetTargets(root, targets, environment);
  try {
    const body = await readSignedBudgetReceipt(root, key, 2);
    if (!body || Object.keys(body).some(field => !['version', 'run', 'settings', 'environment', 'fingerprint', 'primary', 'workers'].includes(field)) ||
      body.settings !== batchSettings(budgets, targets) || body.environment !== selected(environment) ||
      typeof body.fingerprint !== 'string' || !/^[a-f\d]{64}$/.test(body.fingerprint) || !Array.isArray(body.workers) || body.workers.length !== targets.length) return;
    const fingerprint = await fingerprintBudgetBatch(root, artifact, budgets, environment, targets);
    if (!fingerprint || fingerprint !== body.fingerprint) return;
    const primary = restoreBudgetResult(budgets, body.primary);
    const workers = targets.map((target, index) => ({ configPath: target.policy.configPath,
      buildBudgets: restoreBudgetResult(target.policy.budgets, body.workers[index]) }));
    if (!primary || workers.some(worker => !worker.buildBudgets)) return;
    const complete = workers as BudgetBatchResult['auxiliary']['workers'];
    return { primary, auxiliary: { workers: complete, diagnostics: complete.flatMap(worker => worker.buildBudgets.diagnostics),
      valid: complete.every(worker => worker.buildBudgets.valid) } };
  } catch { return undefined; }
}
