---
title: "Stored test results"
description: "Record Vitest runs and read their evidence through CLI and MCP."
---

# Stored test results

Add the opt-in Cossack reporter to your Vitest 4 configuration. Keep your normal
reporter for failure messages and stack traces:

```ts
import { defineConfig } from 'vitest/config';
import CossackTestReporter from 'cossack/vitest-reporter';

export default defineConfig({
  test: {
    reporters: ['default', new CossackTestReporter()],
  },
});
```

Run your normal Vitest command. The reporter writes a versioned local record under
`.vitest/cossack`. Add `.vitest/` to your application's `.gitignore` if necessary.
Use the same project directory for Vitest's `root`, the CLI working directory and
MCP's `--project` argument. That directory must contain `package.json`. A nested
Vitest root stores separate evidence. The reader does not search other directories.
The reporter supports Vitest 4. Other major versions fail explicitly.

Read the most recently started run:

```sh
pnpm exec cossack test-results --json
pnpm exec cossack test-results --run <run-uuid> --json
```

MCP exposes the same service as `read_test_results`. Its input is `{}` or
`{ "run": "<run-uuid>" }`. It accepts no paths or project-root override. The reader
never runs tests, imports application modules or contacts external services.

## Interpret the evidence

The command's `ok` and exit code describe whether the command read the evidence.
A recorded test failure still returns `ok: true` and exit code zero. Inspect
`data.status`, `data.report.state`, `data.report.scope` and `data.freshness.status`:

| Field | Meaning |
| --- | --- |
| `status: missing` | No matching stored record exists. It does not mean tests passed. |
| `state: running` | The start hook wrote a record but no completion is recorded. It does not prove the process is alive. |
| `state: passed` | Vitest reported success for the selected run. |
| `state: failed` | A test, module, unhandled error or runner result failed. Collection failures can have zero test cases. |
| `state: interrupted` | The run was interrupted or retained pending test cases. |
| `scope: selected-tests` | The record covers this selection only, including filtered runs. It makes no full-suite claim. |

The record contains its UUID, Vitest version, start/end times, module and unhandled
error counts, and individual test names, project names, relative paths, locations,
states and error counts. Retried tests can pass with earlier error counts. Records
are local reporter evidence, not independently authenticated results. Copying a
report to another project location is rejected. Run tests in that location instead.

The default reader selects the most recently started run, including unfinished
runs. Finishing an older run cannot hide a newer unfinished one. Use the UUID to
read an earlier run. Equal start timestamps use UUID order as a deterministic tie
break. That ordering does not prove which concurrent run started first.

## Freshness

The reporter hashes bounded project files at run start and completion. Readers
compute another snapshot and return:

| Status | Meaning |
| --- | --- |
| `matches` | All three endpoint snapshots match within the stated file scope. |
| `changed` | Current files differ from the completed run. |
| `changed-during-run` | The start and completion snapshots differ. |
| `unknown` | A snapshot exceeded a limit, hit a link, or failed to read an input. |
| `unfinished` | No completion was recorded. |

Snapshots exclude dependencies, Git data, generated/build/test artifacts, `.env`,
`.dev.vars` and key files. The response describes that scope. A match says nothing
about dependencies, environment values, external services, or files that change
and change back between snapshots. State this limitation whenever you cite a run.

## Privacy and limits

Raw error messages, stack traces, assertion values and stdout/stderr are never
stored. Metadata scrubs known secret values from the process and Vitest project
configuration, plus common credential patterns. It cannot identify every secret
embedded in a title or path. Do not put sensitive data in test metadata. Readers
apply process-secret redaction again. Use normal Vitest output for full failures.

Storage uses atomic file replacement and rejects linked storage directories and
report files. Each record is limited to 2 MiB and 10,000 test cases. At most 128
run records are accepted. Remove old records from `.vitest/cossack` when full.
There is no automatic pruning. Save any evidence you need before you remove files.
If recording fails, an existing start record can remain unfinished.

File snapshots stop at 4,096 files, 8,192 entries, depth 24, 8 MiB per file or
64 MiB total. Incomplete snapshots report `unknown`, never a matching claim.
Corrupt records fail with stable diagnostics without echoing file contents.
MCP reads keep the shared worker deadline, cancellation and response-size limits.
The project boundary is not a sandbox against a malicious local process modifying
files or directories concurrently.
