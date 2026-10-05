/** Node-only literal project policy reader. Never evaluate application config. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateBuildBudgets, type BuildBudgets } from './build-budgets.js';

export interface AuxiliaryBuildBudget { configPath: string; budgets: BuildBudgets; }
const invalid = () => Object.assign(new Error('Auxiliary Worker budgets require unique project-relative config paths and supported positive finite limits.'), { code: 'COSSACK_AUXILIARY_BUILD_BUDGET_INVALID' });

export async function readAuxiliaryBuildBudgets(root: string): Promise<AuxiliaryBuildBudget[]> {
  let manifest: any;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { throw Object.assign(new Error('Cannot read auxiliary Worker budgets. Check package.json.'), { code: 'COSSACK_AUXILIARY_BUILD_BUDGET_READ_FAILED' }); }
  const input = manifest?.cossack?.auxiliaryBuildBudgets;
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 32) throw invalid();
  const result: AuxiliaryBuildBudget[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['configPath', 'budgets'].includes(key))) throw invalid();
    const config = entry.configPath;
    if (typeof config !== 'string' || !config.trim() || config.includes('\0') || config.includes('\\') || path.isAbsolute(config) || path.win32.isAbsolute(config) || /^[a-zA-Z]:/.test(config) || config.split('/').includes('..')) throw invalid();
    const absolute = path.resolve(root, config);
    const relative = path.relative(path.resolve(root), absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || seen.has(absolute)) throw invalid();
    seen.add(absolute);
    const inputBudgets = entry.budgets;
    if (!inputBudgets || typeof inputBudgets !== 'object' || Array.isArray(inputBudgets) || !Object.keys(inputBudgets).length) throw invalid();
    let budgets: BuildBudgets;
    try { budgets = validateBuildBudgets(inputBudgets); } catch { throw invalid(); }
    result.push({ configPath: relative.split(path.sep).join('/'), budgets });
  }
  return result;
}
