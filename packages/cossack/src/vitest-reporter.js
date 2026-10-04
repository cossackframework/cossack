import path from 'node:path';
import { beginTestReport, writeTestReport, testSourceSnapshot, testTextRedactor } from './test-results-service.js';

/** Opt-in Vitest 4 reporter. No raw errors, console logs or assertion values are recorded. */
export default class CossackTestReporter {
  onInit(context) {
    if (!/^4\./.test(context.version)) throw Object.assign(new Error('Cossack test evidence currently supports Vitest 4.'), { code: 'COSSACK_TEST_REPORT_RUNNER_UNSUPPORTED' });
    this.context = context;
    this.root = context.config.root;
  }
  async onTestRunStart(specifications) {
    this.report = await beginTestReport(this.root, { name: 'vitest', version: this.context.version }, specifications.length);
  }
  async onTestRunEnd(modules, errors, reason) {
    if (!this.report) throw new Error('Cossack reporter received completion without a started run.');
    const redact = testTextRedactor(process.env, this.context.config.env, ...modules.map(module => module.project.config.env));
    const tests = [];
    for (const module of modules) {
      const file = path.relative(this.root, module.moduleId).split(path.sep).join('/');
      for (const test of module.children.allTests()) {
        const result = test.result();
        tests.push({ id: redact(test.id), name: redact(test.fullName), file: redact(file), project: redact(module.project.name),
          state: result.state, errors: result.errors?.length ?? 0,
          line: test.location?.line ?? null, column: test.location?.column ?? null });
        if (tests.length > 10_000) throw Object.assign(new Error('Select a smaller test scope for stored results.'), { code: 'COSSACK_TEST_REPORT_LIMIT' });
      }
    }
    const failedModules = modules.filter(module => module.state() === 'failed').length;
    const state = reason === 'interrupted' ? 'interrupted'
      : reason === 'failed' || errors.length || failedModules || tests.some(test => test.state === 'failed') ? 'failed'
      : tests.some(test => test.state === 'pending') ? 'interrupted' : reason;
    const report = { ...this.report, finishedAt: new Date().toISOString(), state, tests, failedModules,
      unhandledErrors: errors.length, after: await testSourceSnapshot(this.root) };
    await writeTestReport(this.root, report);
    this.report = undefined;
  }
}
