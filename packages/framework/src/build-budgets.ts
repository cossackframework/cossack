/** Node-only project budget tooling. Never expose raw Wrangler output. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseStartupProfile, type StartupProfileMeasurements } from './startup-profile.js';
export type BuildBudgets = Record<string, { warning?: number; error?: number }>;
export interface BudgetToolResult { code: number; stdout?: string; }
export interface BudgetToolOptions { env?: Record<string, string>; maxOutputBytes?: number; timeoutMs?: number; toolArgs?: string[]; }
export type BudgetToolRunner = (root: string, artifact: string, options: BudgetToolOptions) => Promise<BudgetToolResult>;
const localMetrics = new Set(['localStartupProfileMs', 'localStartupActiveMs']);
const metrics = new Set(['uploadKiB', 'gzipUploadKiB', 'providerStartupMs', ...localMetrics]);
const invalid = () => Object.assign(new Error('Build budgets must use supported metrics and positive finite warning/error limits.'), { code: 'COSSACK_BUILD_BUDGET_INVALID' });

/** Literal project settings only; never evaluate application config to read budgets. */
export async function readBuildBudgets(root: string): Promise<BuildBudgets> {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { throw Object.assign(new Error('Cannot read project build budgets. Check package.json.'), { code: 'COSSACK_BUILD_BUDGET_READ_FAILED' }); }
  const input = manifest?.cossack?.buildBudgets;
  return input === undefined ? {} : validateBuildBudgets(input);
}

/** Shared literal limits contract for primary and auxiliary Workers. */
export function validateBuildBudgets(input: unknown): BuildBudgets {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const result: BuildBudgets = {};
  for (const [metric, limits] of Object.entries(input) as [string, any][]) {
    if (!metrics.has(metric) || !limits || typeof limits !== 'object' || Array.isArray(limits) || !Object.keys(limits).length) throw invalid();
    for (const [severity, limit] of Object.entries(limits)) {
      if (!['warning', 'error'].includes(severity) || typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) throw invalid();
    }
    if (limits.warning !== undefined && limits.error !== undefined && limits.warning > limits.error) throw invalid();
    result[metric] = { ...limits };
  }
  return result;
}

/** Parse only Wrangler's public size summary, never retain arbitrary tool output. */
export function evaluateBuildBudgets(budgets: BuildBudgets, output: unknown, local: Partial<StartupProfileMeasurements> = {}) {
  const text = typeof output === 'string' ? output.replace(/\x1b\[[0-9;]*m/g, '') : '';
  const matches = [...text.matchAll(/^\s*Total Upload: (\d+\.\d{2}) KiB \/ gzip: (\d+\.\d{2}) KiB\s*$/gm)];
  const sizes: Record<string, number> = matches.length === 1 ? { uploadKiB: Number(matches[0][1]), gzipUploadKiB: Number(matches[0][2]) } : {};
  const measurements = [];
  const diagnostics = [];
  for (const [metric, limits] of Object.entries(budgets)) {
    const isLocal = localMetrics.has(metric);
    const value = isLocal ? (local as Record<string, number>)[metric] : sizes[metric];
    const available = typeof value === 'number' && Number.isFinite(value) && value >= 0;
    measurements.push({ metric, status: available ? 'measured' : 'unavailable',
      ...(available ? isLocal ? { value, resolution: 0.001, source: 'wrangler-local-startup-profile', unit: 'ms' } : { value, resolution: 0.01, source: 'wrangler-dry-run' } : {}), limits });
    if (!available) {
      diagnostics.push({ code: 'COSSACK_BUILD_BUDGET_UNAVAILABLE', severity: limits.error === undefined ? 'warning' : 'error',
        message: `${metric} is unavailable from local deployment validation; its configured budget was not verified.` });
      continue;
    }
    // Wrangler rounds to .01 KiB: require the entire rounding interval to fit.
    const upper = isLocal ? value : value + 0.005;
    const severity = limits.error !== undefined && upper > limits.error ? 'error'
      : limits.warning !== undefined && upper > limits.warning ? 'warning' : undefined;
    if (severity) diagnostics.push({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity,
      message: isLocal ? `${metric} measured ${value} ms in the local startup profile, limit ${limits[severity]} ms. This is not Cloudflare provider startup time.`
        : `${metric} measured ${value} KiB (0.01 KiB resolution), limit ${limits[severity]} KiB; the upper rounding bound does not fit.` });
  }
  return { measurements, diagnostics, valid: !diagnostics.some(item => item.severity === 'error') };
}


async function measure(root: string, artifact: string, options: BudgetToolOptions): Promise<BudgetToolResult> {
  const require = createRequire(path.join(root, 'package.json'));
  const manifestPath = require.resolve('wrangler/package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
  if (typeof bin !== 'string') throw new Error('Wrangler executable unavailable.');
  return new Promise(resolve => {
    const isolated = process.platform !== 'win32';
    const child = spawn(process.execPath, [path.resolve(path.dirname(manifestPath), bin), ...(options.toolArgs ?? ['deploy', '--dry-run', '--config', artifact])], {
      cwd: root, shell: false, detached: isolated, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...options.env },
    });
    let stdout = ''; let bytes = 0; let overflow = false; let timedOut = false;
    const stop = () => { try { if (isolated && child.pid) process.kill(-child.pid, 'SIGKILL'); else if (child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false }).on('error', () => child.kill('SIGKILL'));
    } else child.kill('SIGKILL'); } catch { /* Already stopped. */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 30000);
    timer.unref();
    const capture = (chunk: Buffer, retain: boolean) => {
      if (overflow) return;
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 1024 * 1024)) { overflow = true; stop(); return; }
      if (retain) stdout += chunk.toString();
    };
    child.stdout.on('data', chunk => capture(chunk, true));
    child.stderr.on('data', chunk => capture(chunk, false));
    child.on('error', () => { clearTimeout(timer); stop(); resolve({ code: 1 }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: overflow || timedOut ? 1 : code ?? 1, stdout }); });
  });
}
export async function checkBuildBudgets(root: string, artifact: string, budgets: BuildBudgets,
  options: BudgetToolOptions & { run?: BudgetToolRunner } = {}) {
  const failed = () => ({ valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error', message: 'Local Wrangler artifact measurement failed; no configured budget was verified.' }] });
  const needsStartup = Object.keys(budgets).some(metric => localMetrics.has(metric));
  let directory: string | undefined;
  try {
    const toolOptions = { env: { ...options.env, CLOUDFLARE_ENV: '' }, maxOutputBytes: 1024 * 1024, timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 30000 };
    const run = options.run ?? measure;
    if (needsStartup) {
      directory = await fs.mkdtemp(path.join(tmpdir(), 'cossack-startup-budget-'));
      await fs.chmod(directory, 0o700);
    }
    const bundle = directory && path.join(directory, 'worker.bundle');
    const result = await run(root, artifact, { ...toolOptions, ...(bundle ? { toolArgs: ['deploy', '--dry-run', '--config', artifact, '--outfile', bundle] } : {}) });
    if (result.code !== 0) return failed();
    let local: Partial<StartupProfileMeasurements> = {};
    if (directory && bundle) {
      const bundleStat = await fs.lstat(bundle);
      if (!bundleStat.isFile() || bundleStat.isSymbolicLink() || bundleStat.size > 64 * 1024 * 1024) return failed();
      const profile = path.join(directory, 'startup.cpuprofile');
      const profiled = await run(root, artifact, { ...toolOptions, toolArgs: ['check', 'startup', '--worker', bundle, '--outfile', profile] });
      if (profiled.code !== 0) return failed();
      const stat = await fs.lstat(profile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) return failed();
      const parsed = parseStartupProfile(JSON.parse(await fs.readFile(profile, 'utf8')));
      if (!parsed) return failed();
      local = parsed;
    }
    return evaluateBuildBudgets(budgets, result.stdout, local);
  } catch { return failed(); }
  finally {
    if (directory) {
      try { await fs.rm(directory, { recursive: true, force: true }); }
      catch { return failed(); }
    }
  }
}
