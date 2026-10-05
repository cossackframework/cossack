import { readBuildBudgets, evaluateBuildBudgets, checkBuildBudgets as check } from '@cossackframework/framework/build-budgets';
import { runProjectToolCaptured } from './project-tools.js';
export { readBuildBudgets, evaluateBuildBudgets };
export function checkBuildBudgets(root, artifact, budgets, options = {}) {
  return check(root, artifact, budgets, { ...options,
    run: (project, config, opts) => runProjectToolCaptured(project, 'wrangler', opts.toolArgs ?? ['deploy', '--dry-run', '--config', config], { ...options, ...opts }),
  });
}

export { BUDGET_RUN_ENV, prepareBudgetRun, readBudgetReceipt, assertBudgetSettings } from '@cossackframework/framework/budget-receipts';

import { checkAuxiliaryBuildBudgets as checkAuxiliary } from '@cossackframework/framework/auxiliary-build-budgets';
export { readAuxiliaryBuildBudgets, prepareAuxiliaryBudgetTargets, assertAuxiliaryBudgetTargets, inspectAuxiliaryBudgetArtifacts } from '@cossackframework/framework/auxiliary-build-budgets';
export function checkAuxiliaryBuildBudgets(root, targets, environment, options = {}) {
  return checkAuxiliary(root, targets, environment, { ...options,
    run: (project, config, opts) => runProjectToolCaptured(project, 'wrangler', opts.toolArgs ?? ['deploy', '--dry-run', '--config', config], { ...options, ...opts }),
  });
}
