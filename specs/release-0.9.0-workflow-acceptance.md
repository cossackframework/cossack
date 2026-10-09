# Workflow acceptance scope for Cossack 0.9.0

Codex records the user's decision on 2026-10-09: use actual hosted Cloudflare
acceptance to prove literal provider `Waiting`; retain local native retry, events,
pause, process restart, resume, exact effects, failure redaction and cleanup.
The user accepted the second option explicitly after the local simulator blocker
was explained. This replaces the former local literal-Waiting release criterion;
it does not waive Workflow behavior or claim local Waiting passes.

The original user-owned `workflows-acceptance.js` and
`workflows-release-acceptance.test.js` remain unchanged and unstaged. The release
CLI invocation explicitly excludes that legacy strict probe. A new tracked local
acceptance test covers its other lifecycle obligations using persisted effects
as readiness evidence, without provider patches or status normalization.

Hosted literal Waiting, pause/resume, events/retry and terminal failure are proven
in the [hosted Workflow acceptance](./release-0.9.0-verification-archive.md#codex-workflow-lifecycle-agent-scenario-2026-10-09).
Its private receipts and independently verified teardown remain authoritative;
old deleted resource options must not be reused. Final artifact comparison governs
whether current-version hosted behavior evidence remains applicable after version alignment. Final comparison confirms the Workflow runtime graphs
are unchanged; the independent Database tooling repair has separate installed proof.

All other REL-03/04/05 requirements remain intact. Desktop remains complete by
user decision with its remaining checks waived. Neither this decision nor local
success alone closes any numbered release task.

Final Codex integration: the revised source and installed local lifecycle gates
pass, and hosted literal Waiting retains its archived scope. [Final receipt](./release-0.9.0-verification-archive.md#codex-final-release-acceptance-2026-10-09).
