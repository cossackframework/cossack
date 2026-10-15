# Scoped services, storage and Workflows

Start with the installed offline catalogs:

```bash
cossack docs --package @cossackframework/core --json
cossack docs --package @cossackframework/framework --json
cossack docs --package @cossackframework/core --symbols --symbol Storage --json
```

Select `guidance.guides` by ID. The catalog reports exports/declarations and
package-authored source examples; reading it never executes examples, fetches a
registry or proves provider readiness. Use the installed version's signatures.

## State and service ownership

Use `@State` for replacement, `@Store` for nested plain-object/array mutations,
`@ClientState`/`@ClientStore` for browser drafts and `@Computed` for fresh derived
getters. Computed getters are not a dependency memoization cache. A public state
snapshot, including a TypeScript-private field decorated with State, must not
carry credentials or establish permissions.

Declare services on the owning layout's `@Page({ services: [...] })`.
`ServiceScope` inherits and shadows declarations; `CossackService` gets active
SSR/RPC request context. A browser service call runs under the current page:
the server checks the page's route params, runs that page's layout and page
guards with them as SSR does, and computes the scope key itself. Await disposal. Global DI and module-level createStore
instances are process-local and shared across server requests: reserve those for
stateless services or browser-only theme/toast data, never user/session state.
Read `reactive-state-and-stores` and `scoped-services-and-injection`.

The following portable example uses only public imports:

```typescript
import { createStore, Service, ServiceScope } from '@cossackframework/core';
@Service() class Draft { text = ''; }
const left = new ServiceScope(undefined, [Draft]);
const right = new ServiceScope(undefined, [Draft]);
left.resolve(Draft).text = 'left';
if (right.resolve(Draft).text !== '') throw new Error('Scope isolation failed');
const store = createStore(1);
let observed = 0;
const stop = store.subscribe(value => { observed = value; });
store.set(2); stop(); store.set(3);
if (observed !== 2) throw new Error('Store cleanup failed');
await left.disposeAsync(); await right.disposeAsync();
```

## Authorized object storage

`Storage` from `@cossackframework/core/storage` requires an explicit provider and
authorizer. The Framework R2 provider and Node filesystem provider are server
integrations. Authorize operations from trusted tenant/user context, enforce byte
and content-type limits, pass AbortSignal and consume/cancel streams. Signed URLs
are expiring bearer capabilities redeemed at your application-owned endpoint;
keep the signing secret server-only and recheck authorization at redemption.
No Core fallback pretends to be durable. Read `authorized-object-storage`,
`image-rendering-diagnostics` and the installed provider guides.

```typescript
import { validateStorageKey, StorageError } from '@cossackframework/core/storage';
validateStorageKey('tenant/readme.txt');
let rejected = false;
try { validateStorageKey('../secret'); }
catch (error) { rejected = error instanceof StorageError; }
if (!rejected) throw new Error('Traversal key accepted');
```

Cache/counter locality is independent from object storage. Memory is process-only;
KV reads can be stale and increments are not atomic. Declare required shared,
durable/strong/atomic guarantees and inspect capabilities before I/O. A transport
name or available binding is not proof of a live account. Read
`runtime-and-counter-guarantees` and Framework cache guidance.

## Workflows without a local durability claim

Define input/events/name/version in a pure Core definition. The native class
factory imports `@cossackframework/framework/workflows` only in the Worker entry
graph. Server API helpers import the pure
`@cossackframework/framework/workflows/provider`; keep native `cloudflare:workers`
out of Node SSG imports. Scaffold with `cossack add workflows` only on Cloudflare.
Authorize invoke/inspection/events/admin against trusted ownership; identity is
not authority. The provider owns step persistence and retries. Effects still need
transaction receipts or downstream idempotency.

`createLocalWorkflowProvider` is explicitly process-only development/test state.
A new process/provider loses it. It implements bounded retry/backoff/deadlines,
not a durable engine. Termination cancels owned timers but cannot stop callback
I/O that ignores cancellation. Read `local-workflow-lifecycle` and
`docs/workflows.md` for complete typed examples.

SVC-04 native acceptance is complete at its recorded composite scope. Native
persisted local lifecycle acceptance proves retry effects, pause, process restart,
resume, validated events, completion, failure redaction and cleanup. Actual hosted
Cloudflare acceptance separately proves literal Waiting before and after
pause/resume, with exact retry/event effects and cleanup. The pinned local
Miniflare provider does not prove literal Waiting; release acceptance uses the
approved hosted/local split. The process-only example above proves only local
typed event delivery, completion and redacted process durability. Do not present
this example as native restart or hosted Waiting evidence.
