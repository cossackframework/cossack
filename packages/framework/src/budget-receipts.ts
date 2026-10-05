/** Node-only, invocation-bound budget results. Never persist the signing key or tool output. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkBuildBudgets, evaluateBuildBudgets, readBuildBudgets, type BuildBudgets } from './build-budgets.js';
export const BUDGET_RUN_ENV = 'COSSACK_BUILD_BUDGET_RUN_ID';
const receiptName = 'build-budget-receipt.json';
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
type BudgetResult = Awaited<ReturnType<typeof checkBuildBudgets>>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const settings = (budgets: BuildBudgets) => JSON.stringify(Object.entries(budgets).sort(([a], [b]) => a.localeCompare(b)).map(([metric, limits]) => [metric, { warning: limits.warning, error: limits.error }]));
const selected = (environment?: string) => environment || null;
const receiptPath = (root: string) => path.join(root, '.cossack', receiptName);
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

async function receiptDirectory(root: string) {
  const directory = path.join(root, '.cossack');
  try { await mkdir(directory); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('COSSACK_BUILD_BUDGET_RECEIPT_UNSAFE', 'Budget receipt storage must be a regular project directory.');
  return directory;
}
export async function clearBudgetReceipt(root: string) {
  await receiptDirectory(root);
  await rm(receiptPath(root), { force: true });
}
export async function prepareBudgetRun(root: string) {
  await clearBudgetReceipt(root);
  return randomUUID();
}
export async function assertBudgetSettings(root: string, budgets: BuildBudgets) {
  if (settings(await readBuildBudgets(root)) !== settings(budgets)) throw failure('COSSACK_BUILD_BUDGET_SETTINGS_CHANGED', 'Build budgets changed during the build. Rebuild with the current settings.');
}

/** Conservative no-bundle module inventory; unsupported graphs must be measured again. */
export async function fingerprintBudgetArtifact(root: string, artifact: string, budgets: BuildBudgets, environment?: string): Promise<string | undefined> {
  try {
    const project = await realpath(root);
    const requested = path.relative(path.resolve(root), path.resolve(artifact));
    if (requested === '..' || requested.startsWith(`..${path.sep}`) || path.isAbsolute(requested)) return;
    artifact = path.join(project, requested);
    const directory = path.dirname(artifact);
    const inside = (base: string, file: string) => { const rel = path.relative(base, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
    if (!inside(project, directory) || await realpath(directory) !== directory) return;
    const config = JSON.parse(await readFile(artifact, 'utf8'));
    if (config.no_bundle !== true || typeof config.main !== 'string' || config.build?.command || config.site || config.unsafe || config.wasm_modules || config.text_blobs || config.data_blobs) return;
    const main = path.resolve(directory, config.main);
    if (!inside(directory, main) || (config.base_dir && path.resolve(directory, config.base_dir) !== directory) || !/\.(?:m?js)$/.test(main)) return;
    const redirectFile = path.join(project, '.wrangler/deploy/config.json');
    const redirect = JSON.parse(await readFile(redirectFile, 'utf8'));
    if (path.resolve(path.dirname(redirectFile), redirect.configPath) !== path.resolve(artifact) || (redirect.auxiliaryWorkers?.length ?? 0) !== 0) return;
    const digest = createHash('sha256');
    digest.update(JSON.stringify({ settings: settings(budgets), environment: selected(environment), node: process.versions, directory }));
    let bytes = 0; let files = 0; let sawMain = false;
    const file = async (name: string) => {
      const before = await lstat(name, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || ++files > 4096 || bytes + Number(before.size) > 64 * 1024 * 1024) throw Error();
      digest.update(JSON.stringify([name, String(before.size), String(before.ino), String(before.mtimeNs), String(before.ctimeNs)]));
      const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stream = handle.createReadStream({ highWaterMark: 65536 });
        for await (const chunk of stream) { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) { stream.destroy(); throw Error(); } digest.update(chunk); }
      } finally { await handle.close(); }
      const after = await lstat(name, { bigint: true });
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw Error();
      if (name === main) sawMain = true;
    };
    const walk = async (dir: string) => {
      const stat = await lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
      // Wrangler's module concatenation/gzip follows native directory traversal order.
      for (const name of await readdir(dir)) {
        const full = path.join(dir, name); const item = await lstat(full);
        if (item.isSymbolicLink()) throw Error();
        if (item.isDirectory()) await walk(full); else await file(full);
      }
    };
    await walk(directory); if (!sawMain) return;
    await file(redirectFile);
    const require = createRequire(path.join(root, 'package.json'));
    const manifestPath = require.resolve('wrangler/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
    if (typeof bin !== 'string') return;
    await file(manifestPath); await file(require.resolve('wrangler')); await file(path.resolve(path.dirname(manifestPath), bin));
    return digest.digest('hex');
  } catch { return undefined; }
}

/** Sign only safe metrics; before/after identity prevents caching changed artifacts. */
export async function writeBudgetReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string | undefined, before: string | undefined, result: BudgetResult) {
  if (!key || !uuid.test(key) || !before || before !== await fingerprintBudgetArtifact(root, artifact, budgets, environment)) return false;
  const values: Record<string, number> = {};
  for (const measurement of result.measurements) if ('value' in measurement && typeof measurement.value === 'number') values[measurement.metric] = measurement.value;
  const body = { version: 1, run: hash(key), settings: hash(settings(budgets)), environment: selected(environment), fingerprint: before,
    outcome: result.diagnostics.some(item => item.code === 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED') ? 'failed' : 'measured', values };
  const signature = createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
  const directory = await receiptDirectory(root); const temporary = path.join(directory, `${receiptName}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify({ ...body, signature }), { mode: 0o600, flag: 'wx' }); await rename(temporary, receiptPath(root)); }
  finally { await rm(temporary, { force: true }); }
  return true;
}
export async function readBudgetReceipt(root: string, artifact: string, budgets: BuildBudgets, environment: string | undefined,
  key: string): Promise<BudgetResult | undefined> {
  await assertBudgetSettings(root, budgets);
  try {
    if (!uuid.test(key)) return;
    const directory = await lstat(path.join(root, '.cossack')); const stat = await lstat(receiptPath(root));
    if (!directory.isDirectory() || directory.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return;
    const { signature, ...body } = JSON.parse(await readFile(receiptPath(root), 'utf8'));
    if (typeof signature !== 'string' || !/^[a-f\d]{64}$/.test(signature)) return;
    const expected = createHmac('sha256', key).update(JSON.stringify(body)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')) || body.version !== 1 || body.run !== hash(key) || body.settings !== hash(settings(budgets)) || body.environment !== selected(environment)) return;
    if (body.fingerprint !== await fingerprintBudgetArtifact(root, artifact, budgets, environment)) return;
    if (body.outcome === 'failed') return { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error', message: 'Local Wrangler artifact measurement failed; no configured budget was verified.' }] };
    if (body.outcome !== 'measured' || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) return;
    for (const [metric, value] of Object.entries(body.values)) if (!Object.hasOwn(budgets, metric) || !['uploadKiB', 'gzipUploadKiB', 'localStartupProfileMs', 'localStartupActiveMs'].includes(metric) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    const values = body.values;
    // An unconfigured counterpart is immaterial to evaluation; never expose it as a measurement.
    return evaluateBuildBudgets(budgets, (values.uploadKiB !== undefined || values.gzipUploadKiB !== undefined) ? `Total Upload: ${(values.uploadKiB ?? 0).toFixed(2)} KiB / gzip: ${(values.gzipUploadKiB ?? 0).toFixed(2)} KiB` : '', { localStartupProfileMs: values.localStartupProfileMs, localStartupActiveMs: values.localStartupActiveMs });
  } catch { return undefined; }
}
