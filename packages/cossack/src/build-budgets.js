import fs from 'node:fs/promises';
import path from 'node:path';
import { runProjectToolCaptured } from './project-tools.js';

const metrics = new Set(['uploadKiB', 'gzipUploadKiB', 'providerStartupMs']);
const invalid = () => Object.assign(new Error('Build budgets must use supported metrics and positive finite warning/error limits.'), { code: 'COSSACK_BUILD_BUDGET_INVALID' });

/** Literal project settings only; never evaluate application config to read budgets. */
export async function readBuildBudgets(root) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { throw Object.assign(new Error('Cannot read project build budgets. Check package.json.'), { code: 'COSSACK_BUILD_BUDGET_READ_FAILED' }); }
  const input = manifest.cossack?.buildBudgets;
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const result = {};
  for (const [metric, limits] of Object.entries(input)) {
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
export function evaluateBuildBudgets(budgets, output) {
  const text = typeof output === 'string' ? output.replace(/\x1b\[[0-9;]*m/g, '') : '';
  const matches = [...text.matchAll(/^\s*Total Upload: (\d+\.\d{2}) KiB \/ gzip: (\d+\.\d{2}) KiB\s*$/gm)];
  const sizes = matches.length === 1 ? { uploadKiB: Number(matches[0][1]), gzipUploadKiB: Number(matches[0][2]) } : {};
  const measurements = [];
  const diagnostics = [];
  for (const [metric, limits] of Object.entries(budgets)) {
    const value = sizes[metric];
    const available = typeof value === 'number' && Number.isFinite(value);
    measurements.push({ metric, status: available ? 'measured' : 'unavailable',
      ...(available ? { value, resolution: 0.01, source: 'wrangler-dry-run' } : {}), limits });
    if (!available) {
      diagnostics.push({ code: 'COSSACK_BUILD_BUDGET_UNAVAILABLE', severity: limits.error === undefined ? 'warning' : 'error',
        message: `${metric} is unavailable from local deployment validation; its configured budget was not verified.` });
      continue;
    }
    // Wrangler rounds to .01 KiB: require the entire rounding interval to fit.
    const upper = value + 0.005;
    const severity = limits.error !== undefined && upper > limits.error ? 'error'
      : limits.warning !== undefined && upper > limits.warning ? 'warning' : undefined;
    if (severity) diagnostics.push({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity,
      message: `${metric} measured ${value} KiB (0.01 KiB resolution), limit ${limits[severity]} KiB; the upper rounding bound does not fit.` });
  }
  return { measurements, diagnostics, valid: !diagnostics.some(item => item.severity === 'error') };
}

export async function checkBuildBudgets(root, artifact, budgets, options = {}) {
  let result;
  try { result = await runProjectToolCaptured(root, 'wrangler', ['deploy', '--dry-run', '--config', artifact], { ...options, maxOutputBytes: 1024 * 1024 }); }
  catch { result = { code: 1 }; }
  if (result.code !== 0) return { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error', message: 'Local Wrangler artifact measurement failed; no configured budget was verified.' }] };
  return evaluateBuildBudgets(budgets, result.stdout);
}
