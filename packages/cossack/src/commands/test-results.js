import { commandSpecs } from '../command-specs.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readTestResults } from '../test-results-service.js';

export function testResultsCommand(args, ctx) {
  return runWithSpec(commandSpecs['test-results'], args, ctx, async () => {
    const result = await readTestResults(await findProjectRoot(ctx.cwd), { run: ctx.flags.run });
    if (ctx.flags.json) return { exitCode: 0, data: result.data, diagnostics: result.diagnostics };
    if (result.data.status === 'missing') console.log('No recorded test evidence. Configure cossack/vitest-reporter and run your tests.');
    else {
      const { report, freshness } = result.data;
      console.log(`Recorded ${report.producer.name} run ${report.id}: ${report.state}; source snapshot: ${freshness.status}.`);
      console.log(`${report.tests.length} selected test cases; ${report.failedModules} failed modules; ${report.unhandledErrors} unhandled errors.`);
      for (const test of report.tests) if (test.state === 'failed') console.log(`  ${test.file}${test.line ? ':' + test.line : ''}: ${test.name}`);
      console.log(freshness.scope);
    }
    return 0;
  });
}
export function testResultsHelp() {
  return commandSpecs['test-results'].help(`cossack test-results [--run <uuid>] [--json]

Read .vitest/cossack reports written by the opt-in cossack/vitest-reporter (Vitest 4).
Defaults to the most recently started run, including unfinished runs.
Does not execute tests, import application modules or contact remote services.
The command succeeds when evidence can be read, even when recorded tests failed.
Inspect report.state, report.scope and freshness before using a result.
A matching source snapshot excludes dependencies, generated files and secrets;
it is not proof of environment or external-service freshness.`);
}
