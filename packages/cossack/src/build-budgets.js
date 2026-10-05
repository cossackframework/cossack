import { readBuildBudgets, evaluateBuildBudgets, checkBuildBudgets as check } from '@cossackframework/framework/build-budgets';
import { runProjectToolCaptured } from './project-tools.js';
export { readBuildBudgets, evaluateBuildBudgets };
export function checkBuildBudgets(root, artifact, budgets, options = {}) {
  return check(root, artifact, budgets, { ...options,
    run: (project, config, opts) => runProjectToolCaptured(project, 'wrangler', ['deploy', '--dry-run', '--config', config], { ...options, ...opts }),
  });
}
