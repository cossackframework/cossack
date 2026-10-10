import type { Reporter, Vitest, TestSpecification, TestModule, TestRunEndReason } from 'vitest/node';
/** Opt-in local test evidence for Vitest 4. Configure alongside your normal reporter. */
export default class CossackTestReporter implements Reporter {
    onInit(context: Vitest): void;
    onTestRunStart(specifications: ReadonlyArray<TestSpecification>): Promise<void>;
    onTestRunEnd(modules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>, reason: TestRunEndReason): Promise<void>;
}
