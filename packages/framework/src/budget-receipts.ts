/** Node-only, invocation-bound budget results. Never persist the signing key or tool output. */
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { checkBuildBudgets, evaluateBuildBudgets, readBuildBudgets, type BuildBudgets } from './build-budgets.js';
import { fingerprintBudgetInventory } from './budget-inventory.js';
import { budgetHash as hash, validBudgetKey, writeSignedBudgetReceipt, readSignedBudgetReceipt } from './budget-receipt-store.js';
export { BUDGET_RUN_ENV, clearBudgetReceipt, prepareBudgetRun } from './budget-receipt-store.js';
type BudgetResult = Awaited<ReturnType<typeof checkBuildBudgets>>;
const settings = (budgets: BuildBudgets) => JSON.stringify(Object.entries(budgets).sort(([a], [b]) => a.localeCompare(b)).map(([metric, limits]) => [metric, { warning: limits.warning, error: limits.error }]));
const selected = (environment?: string) => environment || null;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

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
