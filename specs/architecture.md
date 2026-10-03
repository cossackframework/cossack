# Cossack Framework Architecture

This document outlines the architecture of the Cossack Framework, how its packages interact, and the lifecycle of a request.

## Core Principle: Separation of Concerns

The framework is built on a strict separation between the **library** (`core`, `renderer`) and the **application** (`framework`).

- **Libraries (`@cossackframework/core`, `@cossackframework/renderer`)**: These packages are completely agnostic of any specific application. They provide the tools, base classes, and rendering logic. The `core` library must never import from the `framework` or contain application-specific code.
- **Application (`@cossackframework/framework`)**: This is the runnable unit. It consumes the libraries and contains all the business logic, page components, routing, and the final Cloudflare Worker entrypoint.
- **Database (`@cossackframework/database`)**: The workspace Active Record ORM package owns decorated entities, queries, deterministic migrations/seeders, schema drift tooling, and adapters for all supported Node and Workers providers. `ormMiddleware` owns request factories and scopes downstream work. The Framework package does not depend on the database package; generated applications compose the packages structurally.
- **Scaffold (`@cossackframework/scaffold`)**: Node-only recipe engine consumed
 by the `cossack` CLI. It owns base and feature templates,
 preset/provider/module registries, dependency resolution, conflict-safe
 change sets, and schema-v3 scaffold manifests. Creation and later
 `cossack add` operations render the same resolved recipe, so incremental
 composition has the same owned files as equivalent initial onboarding.
 The pure `/registry` entry owns recipe metadata and its declarations. It does
 not import the Node filesystem API declarations or require Node ambient types.
 The root scaffold entry re-exports those types alongside its Node operations.
 Application runtime packages must not depend on this Node-only package.

This separation makes sure that the framework's core is reusable, maintainable, and decoupled from any single implementation.

The pure runtime capability model lives at
`@cossackframework/core/runtime-capabilities`. It has no filesystem, Node, or
framework imports. The framework's existing `runtime-capabilities` entry re-exports
it, and scaffold uses the same checker for planning. This keeps build, inspection,
and recipe decisions consistent without making a library depend on framework.
Recipe resolution records structural facts; rendering rejects unsupported targets
before planning writes. Inspection can therefore report an older unsupported
selection with its feature, target, and manifest source instead of discarding it.

The storage capability model lives at
`@cossackframework/core/storage-capabilities`, also re-exported by framework.
It is independent of platform bindings and application configuration. Profiles
separate process/shared locality, persistence, consistency, logical expiry,
atomic increments and supported operations. A common interface does not imply
distributed guarantees. Unknown traits reject positive requirements; custom
declarations are their implementer's assertions, not remote verification.
The database cache adapter declares structural metadata without importing core
or framework; its deployment/read guarantees remain unknown.

Cache facades/config declarations and limiter guards check requirements before
operations. Cache factories may still construct resources during resolution.
CLI provider inspection uses the compiler parser and selected Wrangler settings,
without executing configuration or contacting a backend. Dynamic declarations
and possible registration overrides remain unknown. Memory limiter capacity
never erases live quotas; framed scope/caller and namespace/key tuples keep
distinct identities separate. See the cache/rate-limiting guides for the
breaking key migration and precise resource/operation limits.

## Local agent inspection boundary

The Node-only CLI owns `inspection-service.js` and the `cossack-mcp` stdio
entrypoint. CLI route explanations/checks and MCP calls use the same static models.
Each MCP request owns an isolated worker with captured stdout/stderr, a deadline
and termination on cancellation. No application runtime package imports the MCP
SDK. Tool arguments cannot change the startup project root. Dependency resolution
can read installed package metadata and imported declarations outside that root.
This project binding is not a sandbox for untrusted local repositories.
The CLI and MCP share `documentation-service.js`. It reads fresh manifests for an
explicit Cossack package allowlist, without executing module entrypoints. Export
conditions and availability are facts. Optional per-package declaration indexing
uses the CLI's pinned TypeScript 6 API alias, without replacing the project's
TypeScript 7 compiler. Programs read installed declaration graphs afresh, resolve
aliases/re-exports and report public signatures with diagnostics and source hashes.
Member comments, JSDoc tags and index signatures remain visible. Exported classes
with public props expose their instantiated declaration shape. Union and unknown
prop contracts are explicit. No DOM behavior or accessibility is inferred.
Export discovery expands bounded file/type matches with Node pattern precedence
and null exclusions, while reporting unsupported or incomplete scans. TypeScript
extension substitution discovers adjacent declarations without running JavaScript.
Missing type coverage remains explicit. No project tsconfig plugins or module
entrypoints execute. Type-only declarations
do not establish runtime value availability. Runtime compatibility is not inferred
from file presence or from declaration signatures. Command schemas and packaged guidance belong to
the CLI version. Library usage guidance lives in each package's `agent-docs.json`
and carries that installed package's version. The CLI validates bounded JSON data,
omits guides whose public imports are unavailable and never executes examples.
A separate tarball acceptance harness compiles and executes selected repository-owned
examples against installed exports. Authored guidance does not establish runtime
compatibility. Stored test results and devtools traces will extend this boundary
through shared services, not shell parsing or arbitrary file reads.

## Server input boundary

Core owns `input` schemas and their inferred parsed/raw types. Schema parsing
uses Web APIs and has no framework, auth or database dependency. The action
input gate lives separately from legacy form validation to avoid a schema/form
import cycle. Action metadata accepts schemas only in 0.9; plain form rule maps
remain supported by form validation. Public method/function-field decorators
check parsed parameters without wrapping native calls or widening browser input
types to RawInputOf. HTTP/SSE/upload component and explicit-service dispatch, plus
socket/forwarded-service dispatch, call this gate before mutation with the
request's owned cancellation signal. Native authored method calls keep their
normal semantics and do not execute decorator guards.

Typed parsing produces new object/array values, rejects unknown fields unless
stripping is explicit, and bounds depth, visits and errors. Refinement callbacks
are application-owned read-only validation. Abort releases their framework
ownership; it does not roll back callback side effects or terminate ignored I/O.
Unexpected callback exceptions remain private internal errors.

The client compiler removes the contract metadata and private module dependencies
that become unused, resolving runtime references separately from type uses and
local bindings. Local contracts retained by runtime client code or exports fail
closed. Foreign contract imports cannot also keep that module in the client
graph, because this file cannot strip its initializers. Shared client form rules
remain separate from the private typed action contract.

## Route generation boundary

Core owns the portable URL constructor at `core/routes`. It encodes declared
parameters and rejects unsupported patterns. It imports no framework or Node APIs.
Framework owns the pure route identity and source ancestry model at `route-ids`.
The Node-only `route-codegen` entry scans the same files as the Vite registry.
The CLI consumes that entry and keeps its compiler-based inspection facts.

Vite and `cossack routes --generate` emit `.cossack/routes.ts`. The virtual import
resolves to this real file, so runtime URLs and TypeScript literals share one
contract. Generated client code contains public patterns and the core helper.
It contains no application runtime imports. Native API declarations use type-only
references to actual module exports and the portable framework `/api` type helpers.
Default function precedence matches native routing; component modules and plain
handlers do not invent validated contracts. Source layout ancestry in the manifest
does not assert that functional API modules execute component layouts.

404 and error components retain source identities rather than competing public
URLs. Unknown-path selection compiles effective source prefixes at application
construction. Literal specificity and route-group precedence select an owner.
Equally ranked disjoint owners use their common source ancestor. The selected
parameter context also scopes request-local helpers. Boundary rendering composes
layout/page middleware using request-owned source/index tokens. An entered
declaration runs once when normal routing, asset fallthrough or error rendering
reuses its scope. This retains short-circuit responses and after-next headers.

SSR sends the selected source path, component ID and reserved boundary marker.
The browser validates status/type/source identity for error documents before
navigation commits. It hydrates the source component and excludes boundaries
from successful page caches. Shared route IDs retain every boundary, while
public URL maps and generated builders exclude them. CLI explanations select
boundary source paths explicitly. PageOptions.route is removed because it never
participated in registration.

Framework's portable `/api` entry owns declared native HTTP contracts. It reuses
core input schemas and JSON snapshots, with explicit request locations and
parsed/raw/wire types. Parsing and authorization precede handler execution.
Output schemas run before JSON serialization; native response mode is explicit.
The pipeline owns a bounded body reader and linked cancellation/deadline until
response headers. Late callbacks remain observed and late bodies are cancelled.
Native streams retain application body ownership after headers. Unexpected
callback/output failures stay private and have correlated server diagnostics.
The shared AST classifier resolves canonical factories and local aliases before
client imports load. CLI inspection reports structural facts and unknown dynamic
contracts without executing application code.

## Page URL state

Core owns immutable query codecs and declarations at `/url-state`. Request
parsing and URL construction share defaults, strict encoding, repeated-key rules
and bounds. They import no framework, Node or renderer APIs. Component readers
cache immutable parsed values by declaration and request/destination URL.
SSR metadata carries public path/query only. Browser contexts use their owned
destination before history commits. Initial application/page hydration uses the
visible URL, including its fragment. Retained layouts receive each destination.

History replacement runs through the existing navigation owner and retains
unrelated application history state. URL construction preserves unrelated query
pairs and fragments. These are page query contracts. RPC methods receive query
values explicitly because their request URLs identify transport endpoints.
Typed patches merge with the latest live pending intent in this navigation
owner. Reads remain committed until a successful transition. Same-path, same-class
page replacement transfers declared browser ClientState/ClientStore values
through a single-use local capability. Raw store targets receive fresh proxies.
Serialized internal fields cannot create this capability. User, transport,
provider or service ownership changes prevent draft transfer.
The renderer captures a local checkpoint of its rendered part tree through
structural component hooks. It imports no core or framework code. Checkpoints
match template identity, part position or repeat key, class, parent and scope.
The framework supplies the old-page/new-page pair after checking ownership.
Core consumes each draft capability before the replacement child initializes
state and mounts. Separate destination and rollback checkpoints prevent a failed
publication from consuming rollback values. Publication predicates reject late
descendant restores. No serialized state can create a draft checkpoint, and no
destroyed instance is reactivated. Active and inactive cache templates participate.
Pending inactive branches hold local capabilities instead of live outgoing DOM
or tasks. Core can fork an unconsumed, class-bound capability into independent
plain draft graphs without reading its former owner. Renderer recapture rebases
parent identities and forks those pending trees for another destination/rollback
pair. A consumed, unknown or wrong-class capability cannot be forked. Cache exit,
key/owner mismatch, explicit discard and publication revocation prevent restoration.
The browser App has its own ownership key. A changed user or navigation scope
prepares a fresh App and root service scope. The App uses its own transport and
provider metadata rather than the child page's transport. Owned renderer root
listeners publish only for the active App. Precommit rollback restores the old
App and listener, while successful retirement detaches it. Null render output
clears the former DOM. Root scope disposal waits for component cleanup, including
asynchronous layout hooks, so cleanup retains its original request facilities.
Declared scoped services follow this lifecycle. Legacy global injection does not.
Retained layouts keep their service instances and browser drafts. Matching SSR
resource entries replace the previous map before query dependencies change;
entry identity rejects late results. This does not abort application I/O.
Framework-created history entries carry an app group and position. Guarded or
failed precommit traversals restore the prior owned entry by moving through
browser history, retaining its metadata. Confirmation resumes the original
traversal without pushing another entry. Restoration events bypass guards and
fetches. Unknown history positions fail rather than inventing a replacement.
Page and layout imports resolve before live context/tree mutation. A sequence
check rejects superseded modules before publishing SSR state or resources.
Full staged-commit and ownership-change acceptance remains RT-08 work.
Bounded completion and navigation diagnostics remain RT-09 work.

## Development navigation diagnostics

Framework emits fixed-field `cossack:navigation-diagnostic` records only in
development. Per-document IDs correlate navigation decisions without retaining
URLs, application identifiers, state or errors. Cache invalidation and prefetch
use a null navigation ID. Core scroll application returns its actual decision,
so the framework does not duplicate fragment/history selection logic. Layout
counts describe attempted publication. Animation rejection has an independent
lifetime and can be reported after navigation finish. Diagnostics do not replace
runtime acceptance or backend read-count verification.

## Authored route inheritance

Route dispatch searches authored prototypes before the Cossack base prototype.
An inherited render() selects SSR for an HTTP page. Inherited API methods can
handle requests, with get() taking precedence over the init() alias. Framework
no-op methods are not authored handlers. A derived declaration shadows its base
member, and lookup does not invoke accessor handlers.

## Application socket registry

Framework AppDurableObject reads the same virtual:cossack-pages registry as the
router. It preserves compiler source keys for eager pages and layouts. Only
modules with a default Cossack subclass become remote component targets. Named
helpers and native HTTP handlers are excluded. A library-relative glob cannot
resolve generated application components and must not serve this registry.
Core CossackDurableObject remains application-agnostic and calls the framework's
registry hook during initial connection and durable reconstruction.

The client security load hook also uses the shared source classifier for
functional HTTP route modules. Their export shapes become throwing stubs before
any original body or transitive dependency enters the browser graph. This covers
Web API and binding-only handlers without known server-library imports. Default
and named exports retain their shapes. Runtime export stars fail closed when the
shape cannot be determined. SSR and component-class transformations keep their
existing paths. This does not infer arbitrary non-route module privacy.

## Server resource lifecycle

Core owns resource entries, status snapshots and lifecycle operations. The
compiler extracts private loaders into existing Server methods, keeps generated
field getters and emits each class's reserved __cossackResourceFields registry.
Core uses that registry, including inherited fields, to bind a named getter for
status/refresh without invoking arbitrary getters. Refresh binds current
arguments with loading suppressed, then starts one new entry. Inline render
resources retain stable compiler IDs and their last declared invocation.

Named resource reconciliation uses `reconcile$(failure, ...names)`. The shared
RpcError classifier selects known uncertain diagnostics. Core binds all targets
before dispatch and caches one promise per error object, sorted target set and
current dependency identities. Refresh entries bind synchronously so subsequent
dependency changes cannot redirect an earlier recovery. Entry identity and
failure state determine recovered/superseded/failed results. Destruction discards
the weak cache. Recovery never retries the mutation or changes its error.
Application-authored failure codes do not establish transactional outcomes.

Framework RPC target reconstruction calls `__renderRpcTarget`. A synchronous
module depth suppresses incidental resource loader dispatch across nested
components. The render still builds deterministic child targets. A finally block
releases the suppression before the selected action executes. SSR and browser
render discovery retain ordinary resource loading. No asynchronous request state
or additional resource entry system is introduced.

The optional Cossack Resources name union checks lifecycle targets against public
fields. Status value types come from those fields without branding or wrapping
application values. Untyped names still fail at runtime when unknown. Serialized
resources carry settled values and dependency identity; unresolved initial values
must not become resolved hydration entries. Client hydration reuses matching
entries and retains stale data when dependencies differ. Entry identity and the
destroyed phase gate settlement; obsolete failures cannot fail an active SSR pass.

Resource dependencies are public, JSON-preserving finite/plain values. Validation
runs before custom serialization hooks and rejects undefined dependencies. Generated methods validate results before RPC JSON as well as SSR
settlement. Cycle checks track ancestors so shared acyclic references remain valid. Unmount discards
resource completions and forbids new reads; it does not terminate ignored I/O.
Task identities remain owned after setup settles, and abort before rerun cleanup
or component/descendant cleanup. Each execution receives an immutable TaskContext;
its synchronous commit validates a plain reactive-field patch before writes and
checks execution ownership before each assignment. Superseded/destroyed commits
return false. Direct application writes still require cooperative cancellation;
this is not an I/O termination or transactional rollback mechanism. Task metadata
is gathered root-to-child, with child declarations replacing the same method's
kind/dependencies before environment filtering. Typed decorators check declared
public/dependency-shape paths; reactive runtime metadata remains authoritative.

## Resource authorization boundary

Auth owns the typed `createResourcePolicy<Resource, User>()(rules)` kit. The
application owns record lookup and write consistency. Core has no auth/ORM
dependency: `@Server({ authorize })` takes a structural callback over the parsed
first argument, trusted Hono context and owned action signal. Both router gates
and socket dispatch enforce it after input validation and before method invocation.
Forwarded services use their declaring class metadata. Only a boolean `true`
grants access. Expected denials have fixed 401/403 messages/codes and request IDs;
unexpected policy/lookup failures remain internal.

Native API handlers, SSR/resource reads and internal method calls explicitly use
`policy.authorize` or resource middleware. Metadata does not wrap authored calls.
`policy.permissions` derives frozen named booleans for UI state; changing those
client booleans cannot establish resource access. An upstream server authentication
middleware supplies the actor. Connection freshness/revocation is a separate
session requirement, not an authorization-kit guarantee.

Policy callbacks/lookups receive cancellation signals; abort releases framework
ownership, not their underlying I/O or side effects. Check ownership again in a
conditional write/transaction when records can change between lookup and mutation.
The compiler removes authorization metadata and dead private policy dependencies,
including those used only by server read methods. Shared client helpers survive.
Static core typed-decorator factory aliases use the same classification/stripping.

## Desktop runtime boundary

`@cossackframework/desktop` is the sole native application runtime. Its
Electron main process serves renderer assets and framework SSR/RPC through the
private `cossack://app` protocol and injects `ASSETS` plus a window-scoped
`COSSACK_DESKTOP` binding. It is a side target independent of the Cloudflare,
Node, or Deno web adapter and supports HTTP page transport only.

Renderer code has no Electron client entry, preload bridge, Node integration,
or generic IPC channel. Native calls run in bootstrap modules or server-only
component methods. The Desktop package may use Node/Electron APIs; core and
shared library packages remain Web Standard compatible.

## Request Lifecycle

The lifecycle of a user interaction is split into two main phases: the initial server-side render and the subsequent client-side interactivity.

### 1. Initial HTTP Request & Server-Side Rendering (SSR)

1. A user navigates to a URL (e.g., `/tasks`). The request hits the Cloudflare Worker.
2. The Hono router matches the incoming URL to a route and identifies the corresponding Page Component.
    * **TypeScript Components**: Standard `index.ts` files.
    * **MDX Components**: `index.mdx` files which are automatically transformed into component classes during the Vite build process.
3. **Routing & Middleware**: The router identifies the stack of **Layouts** relevant to this page (e.g., `RootLayout` -> `DashboardLayout` -> `TasksPage`) and applies all their middlewares in order.
4. **Error Boundaries**: If a component fails to load or render, the router searches for the **nearest `error/index.ts`** page up the directory tree. Similarly, if a route is not found, the router searches for the **nearest `404/index.ts`**. This allows for localized error UI while preserving parent layouts (like sidebars).
5. **Bootstrapping**:
    * The Global `App` component is instantiated and bootstrapped.
    * Each `Layout` in the stack is instantiated and bootstrapped.
    * The `Page` component is instantiated and bootstrapped.
6. **Data Loading**: The component's `init()` method is called to fetch the initial data. This method is server-only by default and runs in the server environment, with access to databases and other server resources.
7. **Rendering**: The content is rendered inside-out: `App(RootLayout(DashboardLayout(Page())))`.
8. **Metadata Merging**: The framework processes metadata from the inside-out using the `head()` method. The Page provides the initial values (automatically extracted from frontmatter in MDX components), which are then passed to each Layout in the stack, and finally to the Global App for final branding or global tags.
9. The final HTML page is constructed, embedding the rendered HTML, the serialized initial state, and the merged head tags into the response.
10. The complete HTML page is sent to the user's browser.

### 2. Client-Side Hydration & Navigation

1. The browser receives the HTML, renders the initial view, and downloads the client-side JavaScript.
2. An instance of the `Tasks` component is created in the browser.
3. The component's `bootstrap` method runs its client-side path.
4. It reads `window.__INITIAL_STATE__` to instantly populate its `@State` properties.
5. **Client-Only State**: It also initializes any properties decorated with `@ClientState`. These properties are NOT synchronized with the server and are excluded from the initial state script.
6. It also reads the list of server method names and **replaces them** with proxy functions.
7. It sets up the configured transport. Pages default to HTTP RPC. SSE pages subscribe to their event stream, while WebSocket/Durable Object pages connect to their state provider runtime.
8. **Instant Navigation (Soft Navigation)**: When a user clicks a link (e.g., `<a href="/about">`), the framework intercepts the click. instead of a full reload, it:
    * **Pre-fetching**: The framework automatically begins fetching the next page data when the user hovers over a link, effectively hiding network latency.
    * **Caching**: All visited and pre-fetched pages are stored in a memory cache. If a URL is in the cache, the transition happens instantaneously without a network request.
    * **Component Swap**: The current component instance is destroyed (closing WebSockets), and the new component is instantiated and bootstrapped using the state parsed from the fetched HTML.
9. **Programmatic Navigation**: Components can call `this.redirect('/new-path')`. On the client, this is automatically intercepted and handled as a soft navigation (SPA transition) rather than a full browser reload.

### 3. Server Runtime Interaction & State Synchronization

Authored TypeScript retains a server method's native signature. Client handlers
can use `rpc$(this.method(...))` to infer `RpcCall<Result, Yield>` from that
signature without waiting for Vite transformation. This returns the framework's
existing call by identity; it does not execute another request. Server execution
keeps native return types. Ordinary calls only return final results; generator
calls expose yields and completion separately on every transport.

1. When a user performs an action (e.g., clicks a button), they call a client-side **proxy function**.
2. **Function Binding**: Component methods are automatically bound during bootstrap. Use regular methods for event handlers and mark browser handlers with `@Client()` (or another appropriate client-safe decorator). Arrow-function class fields are unnecessary.
3. **Optimistic UI**: If the method is decorated with `@Optimistic`, the client executes the handler immediately, updating the local UI state before the request is even sent.
4. The proxy function sends the action through the configured transport: HTTP RPC for HTTP/SSE pages, or a message over the provider's WebSocket.
5. The **Server Runtime** (e.g., `AppDurableObject` or `NodeWebSocketRuntime`) receives the message and calls the real method on its internal component instance.
6. From here, one of two state synchronization patterns occurs:

 **a) Automatic State Push (Default):**
    - The server method modifies a `@State` property (e.g., `this.feedCount++`).
    - The `@State` decorator's setter is triggered and queues a microtask to broadcast the change.
    - The Runtime identifies all state properties belonging to the same **channel** as the changed property (e.g., `feeds`).
    - It constructs a **partial state object** containing only the properties for that channel.
    - The Runtime broadcasts this partial state to **all** clients connected to it.
    - The client receives partial public state and requests a render. Pending optimistic calls retain their owned field previews until settlement; authoritative values update their confirmed base.

 **b) Event-Driven Re-fetch (Manual):**
    - The server method modifies a database or other external source of truth.
    - It then calls `this.broadcastEvent('some-event-name')`.
    - The Runtime broadcasts this simple event message to **all** connected clients.
    - Any client-side component with an `@OnEvent('some-event-name')` handler will execute that handler.
    - The handler's job is typically to call `this.init()` again, which re-runs the original, permission-aware query to get the fresh, secure state.
    - The component updates its state from the new query and re-renders.

### 4. State Persistence

The framework handles state persistence differently depending on the runtime environment:

- **Cloudflare Workers (Durable Objects):** The `@State` properties are automatically persisted to the Durable Object's transactional storage. State survives server restarts and hibernation.
- **Node.js (Node Adapter):** The `@State` properties are strictly **in-memory**. If the Node.js server process restarts, all component state is reset to initial values. Developers running on Node.js should persist critical data to an external database manually within their action methods.

## Security: Code Splitting & Server-Only Code Stripping

The framework includes a **security plugin** (`vite-security-plugin.ts`) that automatically strips server-only code from client bundles during the build process. This makes sure that sensitive code (database queries, API keys, business logic) is never exposed to the browser.

### How It Works

During the client build, the `cossackSecurityPlugin` analyzes component class methods and:

1. **Keeps** methods decorated with `@Client`, `@Optimistic`, `@Computed`, `@Shared`, `@OnEvent`
2. **Keeps** built-in lifecycle methods: `render`, `head`, `onMount`, `onCleanup`, `escapeHtml`, `loadingTemplate`, `toString`, `valueOf`
3. **Keeps** property getters and setters (accessor methods)
4. **Stubs** methods decorated with `@Server` (replaces body with RPC proxy stub)
5. **Stubs** methods without any decorator (secure by default)

**Note:** The `init()` and `get()` methods are **server-only by default** and will be stubbed in client bundles unless explicitly marked with `@Shared`.

### Method Classification

#### Server-Only (Stripped from Client Bundle)
- Methods decorated with `@Server` → stub becomes RPC proxy
- Methods without any decorator → stub becomes RPC proxy
- `init()` method (unless marked `@Shared`)
- `get()` method (unless marked `@Shared`)

#### Client-Safe (Kept in Client Bundle)
- Methods decorated with `@Client`, `@Optimistic`, `@Computed`, `@Shared`, `@OnEvent`
- Built-in lifecycle methods: `render`, `head`, `onMount`, `onCleanup`, `escapeHtml`, `loadingTemplate`
- Property getters/setters
- Properties decorated with `@ClientState`

### Seamless RPC Proxying

When a server-only method is stubbed, the framework enables **seamless RPC proxying**. Client methods can call server-only methods directly, and the calls are automatically routed through the appropriate transport (HTTP or WebSocket).

**How it works:**
1. Server-only methods are replaced with stub functions that check `this.__cossack_proxies` map
2. During client bootstrap, proxy functions are automatically registered for all server-only methods
3. When a client method calls a server-only method (e.g., `await this.init()`), the proxy intercepts the call
4. The proxy forwards the call to the server via the configured transport
5. The server executes the real method and returns the result

**Example:**
```typescript
class LifecycleDemo extends Cossack {
  @State()
  data: string[] = [];

  // Server-only - stub becomes RPC proxy
  async init() {
    // Database query, API calls - stripped from client
    this.data = await db.select().from('users');
  }

  // Client method can seamlessly call server-only method
  @Client()
  async reload() {
    // This call is automatically proxied to the server
    await this.init();
    this.data = ['Cossack', 'Hono', 'Cloudflare'];
  }
}
```

### The `@Shared` Decorator

The `@Shared()` decorator marks a local-only method as safe to run on both client and server. Unlike `@Server` methods (which become proxies on the client) or `@Client` methods (which may be invoked from the server), `@Shared` methods retain their full implementation on both sides and are never registered as RPC actions.

**Use `@Shared` for:**
- Pure functions that do not access server-only resources
- Validation logic that needs to run consistently on both sides
- Data transformation utilities

**Example:**
```typescript
class MyPage extends Cossack {
  @Shared()
  validateEmail(email: string): boolean {
    // Runs identically on both client and server
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  @Server()
  async createUser(email: string) {
    // Server-only - this code is stripped from client bundle
    if (!this.validateEmail(email)) {
      throw new Error('Invalid email');
    }
    return await db.insert(users, { email });
  }
}
```

### Metadata Injection

For methods detected as server-only (without explicit `@Server` decorator), the plugin automatically injects a static `__registerServerOnlyMethods()` method that registers them in the `cossack:server-methods` metadata. This enables the RPC proxying system to work without requiring explicit `@Server` decorators on every server-only method.

### Build Configuration

The security plugin is automatically applied in the `client` environment of the unified `vite.config.ts`. It does **not** affect the SSR/worker environment, ensuring server code remains intact.

### Development vs Production

In development, calling a server-only method via a proxy that has not been set up yet throws a descriptive error:
```
Error: [Cossack] Method MyPage.init is server-only. The proxy has not been set up yet. Make sure this method is called after bootstrap.
```

In production, the stub is minimal to reduce bundle size while still checking for the proxy before execution.

## Testing

The framework uses vitest for unit tests and Playwright for end-to-end tests.

### Unit Tests

Build the workspace dependencies, then run every package with a unit suite:

```sh
pnpm build
pnpm typecheck
pnpm test:unit
```

The root command runs Vitest once (no watch mode), including UI, auth, Node
adapter, framework, and test-utils tests. The root command runs package suites
serially because framework pretest recreates library exports used by CLI tests.
Use `pnpm --filter <package-name> exec vitest run <test-file>` for a
focused run. Similar direct-binding and spread-binding renderer tests cover
different execution paths and should both be retained.

### End-to-End Tests

Run all e2e tests:
```sh
cd packages/framework && pnpm exec playwright test
```

Run a specific test file:
```sh
cd packages/framework && pnpm exec playwright test e2e/pages/nested-state.spec.ts
```

Note: Each nested component instance maintains its own isolated state on the server, enabling true component isolation in stateful applications.

## Transport security boundaries

Page and enclosing layout middleware also run before transport handlers create
components. Layout-service RPC uses the owning layout guard stack. HTTP RPC and
uploads require an allowed Origin header. SSE scopes are recomputed on the
server for subscriptions and actions, including custom scopes.

Durable Object proxy requests replace client-supplied identity headers with the
trusted authentication context. WebSocket actions expose the caller's identity
through `this.user` and `this.c.get('user')` for the duration of the serialized
action. Applications still check resource permissions inside server actions.

Client code stripping fails on parse errors. Base aliases, local inheritance,
and component/service decorators participate in class discovery.

## Streaming component actions

HTTP and SSE component RPC share a response-local async iterable protocol.
Each action executes once. The client call can be iterated for yields or awaited
for the final result. Promise consumption drains yields; unobserved event-handler
calls drain automatically. Iteration has one consumer and cancels on early return.
Frames include a version, type, request ID, public state, and yield/final value
or structured error. UTF-8 frames are bounded to 1 MiB on both sides.

The response-local reader correlates frames against the HTTP response ID, or
learns the first valid frame's ID when no header is available. Parser and reader
failures retain that ID. Yields remain incremental; done/error frames are held
until EOF validates that no data follows. Final state is applied only after that
validation. Abort/deadline ownership continues through EOF. WebSocket terminal
frames complete their individual pending call; the multiplexed socket remains
open and ignores foreign or completed request IDs.

RPC action limits use the same counter decision for HTTP and socket dispatch.
The server assigns a canonical route owner to components; it is internal state,
not client hydration data. A component budget includes that owner, the action
class, method and caller, so changing socket/request/child IDs or HTTP encoding
does not restore a shared budget. Sibling instances of one child class share
their budget while the page class remains separate. Explicit service budgets
use the owning layout and slot. Socket evaluation uses authenticated peer
identity and the originating socket's request context. Cloudflare persists
upgrade URL/params/filtered headers in native attachments and creates a fresh
Hono context per action, without HTTP credentials or arbitrary middleware
variables. Oversized context fails before acceptance; legacy sockets without
metadata must reconnect. Node/Deno retain their own verified upgrade contexts,
including framework-decoded page params, instead of borrowing the first peer's
headers. The rate-limit Durable Object persists each bucket's counter and deadline
in a storage transaction, preserving spent windows through reconstruction.
Expiry alarms remove old records without erasing a newer window. Memory remains
process-local and KV approximate. DO counter validation rejects corrupt records
and replies instead of granting a fresh budget. Store failures
reject before mutation. Process-local SSE publishes page state after child
actions, matching distributed page/target snapshot separation.

Server cache durations use integer milliseconds (`ttlMs`), matching limiter
windows. The facade defaults `set()` to one hour; direct stores/batch entries
omit expiry unless requested. KV uses framed namespace/key tuples and versioned
value envelopes with logical millisecond deadlines, plus native retention rounded
up to at least 60 seconds. Legacy unframed records are intentionally not reused.
Database/DO epoch timestamp layouts remain compatible.

Cache selection belongs to the current request. Built-in wrappers are memoized
by actual binding identity and complete named declarations; missing/invalid
current bindings fail before memo lookup. Named memory stores are process-local
with LRU count and serialized-byte limits. Custom factories reuse unchanged
selections within a request only; shallow env descriptors and binding identities
are tracked, and nested objects must remain stable. Factories retain their own
resource ownership; the manager cannot infer disposal. `remember()` captures its
provider before awaiting work and allows duplicate concurrent computations.
DO cache stubs are obtained inside operations. Their bounded, strict-UTF-8 JSON
reads require EOF, with a five-second I/O deadline and the current request signal.
Cleanup never awaits producer cancellation. Dispatched writes can still commit;
there is no rollback/retry promise. Database and framework validators remain
independent pure modules so libraries do not depend on the application. Batch
input validation precedes writes, but storage failures can leave partial batches.

Each limiter evaluation captures its request environment's store. Automatic
selection caches unchanged environment/binding/credential descriptors without
changing a global last-selected backend. Invalid explicit configuration rejects;
unset configuration uses the process memory default. Manual store registration
is intentionally process-wide and takes precedence. Shared components prefer
the current action context's environment for limiter evaluation. Runtime options
and all store replies are validated before mutation. Redis uses atomic millisecond
PEXPIRE with checked PTTL; KV retains records for at least 60 seconds and uses
their millisecond logical deadlines. KV remains approximate, with one write per
key per second and no strict bound on cross-region under-counting.


Limiter decisions own a five-second default deadline, independent of window and
client method timeout. Built-in async providers and framework custom-store
calls receive an abort signal; even uncooperative custom stores are raced.
DO/Redis replies use a bounded 8 KiB strict UTF-8 reader through EOF; KV text
records are bounded before parsing. Non-success and late responses are cancelled
and reader locks released, without waiting indefinitely for producer cleanup.
HTTP request abort or socket call cancellation/close suppresses late action
invocation and releases the decision queue. Backend increments already dispatched
are not rolled back or retried. Incoming Cloudflare disconnect notifications
require `enable_request_signal`. Native cross-Worker RPC cancellation removes
queued callbacks without invoking them or releasing the active slot. The router
uses a private operation ID and an abort callback to cancel pending counter
decisions in the originating Worker; response cancellation releases its slot
without waiting for producer cleanup. Started application work may finish.
The installed workerd baseline did not report a pre-header TCP disconnect,
even in a minimal direct-socket Worker; explicit-signal tests do not prove that
notification. Full application deadlines and native disconnect acceptance remain
open. HTTP/multipart/service proxies send a bounded UUID v4 correlation ID
before dispatch, retained by the transport guard without changing authorization.

Generator iteration and cleanup run in an AsyncLocalStorage snapshot captured
from the action request. Components, their descendants, and layout scopes remain
alive through the stream. SSE subscriptions only receive state updates; they
never retain or pull an action generator. Distributed SSE scopes use a SQLite
snapshot and bounded event log in `SseDurableObject`; Node/Deno stay process-local.

Request-context middleware exposes a structural response lifetime under
`cossack:response-lifetime`. A middleware can call
`deferCleanup(() => Promise<void>)`; a true result transfers cleanup to the
retained streaming response. A false result leaves cleanup with that middleware.
The response releases components and services before retained middleware
resources, and closes every registered resource even if another close fails.
Database factories use this contract without importing the framework. Ordinary
responses retain their existing middleware cleanup behavior.

Response header timing is separate from response body ownership. The outer
request-context middleware exposes core's structural `ResponseHeaderState`
under `cossack:response-header-state`. It seals headers only after downstream
middleware finishes, so flash and session middleware can still finalize cookies.
It guards `c.header`; core cookie and flash helpers use the same structural
contract without depending on framework. Session rotation/destruction check
the guard before any storage changes. Retained stream pulls and cleanup cannot
change headers through these helpers. Direct mutation of raw `Response.headers`
does not participate in this guard.

Generators remain lazy to preserve backpressure. Authors prepare cookies or
flash in an ordinary async action before returning a generator. HTTP/SSE RPC
materializes native redirects as client navigation metadata and preserves
native, helper, and middleware cookies together. WebSocket results reject native
HTTP responses explicitly; serialized value trees reject nested HTTP objects.
Background transport requests preserve valid incoming flash; HTTP error statuses
discard partial outgoing flash. Stream failures after headers finalize cannot
roll back cookies or completed mutations.

Core owns the JSON RPC value contract through `snapshotRpcValue` and
`snapshotRpcFrame`. Transports snapshot data once before encoding. Valid dates
become ISO strings; undefined object fields disappear and array holes become
null. Data/model instances contribute own enumerable fields. A typed custom
`toJSON` supplies its validated representation, with a consistent empty root
result key across envelopes. Cycles, non-finite numbers, opaque/binary values,
and excessive nesting reject with paths. Component file arguments retain their
separate multipart extraction boundary; ordinary multipart results use this
snapshot contract too. The extraction walker preserves own __proto__ data keys.

Public `RpcSerialized`, `RpcResult`, and `RpcYield` describe JSON results and
yields. The compiler delegates recognized return annotations to the same types
used by authored `rpc$` inference, avoiding a second type vocabulary. Native
server code keeps its authored types; client code receives data without native
model prototypes. Parameter and hydrated component property annotations still
need to describe their JSON representation; this does not add native revival.

Core `shared/rpc-json.ts` owns ordinary HTTP/SSE JSON response validation for
component and explicit-service clients. It consumes the entire body with a
1 MiB total byte cap, fatal UTF-8 decoding, abort ownership and reader release
before hydration/completion. Service success requires an object state wrapper;
component state cannot carry that wrapper. Redirect metadata is an exclusive
HTTP/HTTPS-or-relative URL branch. HTTP failure fields have structural checks
and body/header request IDs must agree. Non-JSON middleware/native failure
bodies remain opaque generic status errors. The component's ordinary state key
`requestId` is not diagnostic metadata. Decoder failures cannot undo mutations.

Ordinary native HTTP RPC responses use the reserved `X-Cossack-Rpc-Response:
native` marker. Component/service clients check this before examining MIME types
or JSON state, so user JSON and NDJSON bodies cannot become protocol metadata.
Core consumes the native body with a bounded growing byte buffer before resolving
`RpcCall<Response | undefined, never>` to a local response. The 1 MiB cap,
deadline, cancellation and server response lifetime apply through consumption;
unobserved calls also drain and release resources. Native response status/text,
browser-visible headers and bytes are preserved. Redirects retain navigation
metadata and undefined completion. Native bodies are not state envelopes and do
not hydrate action state. Non-success statuses retain RPC error handling. Upload
XHR uses arraybuffer and copies browser-visible headers. WebSocket rejection
cancels a native response body; Response values in generators remain invalid.

JSON and multipart actions now share one router dispatcher registered at `/crpc`
and `/upload`. `readRpcRequest` decodes/caches the body for guards and dispatch,
restores nested file references using own-property records and validates envelope
shapes. Malformed/duplicate metadata or missing/duplicate file parts reject before
construction or mutation. Origin checks remain before parsing, and addressed
page/layout guards remain before component/service construction. Multipart calls
therefore inherit JSON RPC's full layout ownership, input validation, scoped
cleanup, SSE coordination, native response handling and response lifetimes.

Core service proxies encode nested files through the shared multipart helpers.
Component proxies use Fetch unless a numeric method-progress field selects XHR.
The XHR bridge resolves a stream at response headers, forwards stable complete
UTF-8 frames progressively and retains upload progress/native binary metadata.
Frame sizes are bounded, but native XHR accumulates response text and cannot
pause the network reader. Fetch remains the default for long replies and download
backpressure. Both paths feed the same RPC parser and lifetime/cancellation
contract. `createRpcCall` queries the client's known request ID when cancellation
closes an iterator parked at a yield, so its synthetic cancellation error retains
correlation even without another transport read.

### Reactive field contracts and diagnostic ownership

Core collects each class's own State, Store, ClientState and ClientStore metadata
from root to child. A child declaration replaces the complete contract for that
field; unrelated parent fields remain. Bootstrap, service snapshots/forwarding,
request sanitization, optimistic field discovery and channel validation use this
same collector. Only final public State/Store fields are accepted from request
overlays. Client-only overrides cannot inherit public input permission.

Public state remains shallow or deep according to its decorator. Computed getters
calculate on read; rendering follows their reactive inputs rather than a computed
cache. Standalone createStore owns replacement notifications and subscriptions,
without component serialization or automatic server synchronization.

Development snapshot diagnostics use a bounded read-only mode of the canonical
RPC value traversal. They inspect known data descriptors without executing custom
serialization hooks/getters, and report owner/field/path rather than values.
Unknown representations remain subject to real serialization. Diagnostics do not
normalize snapshots or reject state writes. Core library builds retain consuming
Vite mode selection, with safe optional env access for direct Node imports.
Production state and serialization semantics are unchanged.

### Optimistic invocation ownership

Core owns a weak per-target ledger of invocations and resulting reactive-field
values. Handlers execute once and synchronously. Plain field trees are detached
for capture, without serialization hooks; native values remain scalar references.
Each call can remove its own preview without restoring an old whole-component
snapshot. Newer confirmed replies and later local writes have separate ownership.
This representation does not infer arithmetic/array operations or provide a
database transaction. Later nested edits protect the complete reactive field.

Component and service setters record local edits. The shared RPC state applier
combines call-owned fields with the canonical JSON comparison for unrelated
request fields. Explicit service replies are filtered by their public metadata
before merging. HTTP/service request state excludes pending previews and includes
user-authored public edits. Client-only state stays outside that request overlay.
Uncorrelated completion broadcasts cannot settle correlated calls. Loading counts
settle once through the owning call lifecycle.

Each service scope records active loading ownership by declared service class
and invocation. Subscriptions identify the declaration they consume. New consumers
attach to matching pending invocations. Each invocation records one release per
consumer, so duplicate injection and unsubscribe/rejoin retain a single count.
Another declaration or a shadowing scope does not inherit that ownership.
Exited consumers still release when the call settles, without another render.
Same-named component and service actions retain independent loading contributions.
This does not cancel service work when its layout exits or prove server rollback.

Public `optimistic<Host>(target)` helpers bind to the exact synchronous handler
capture. They record finite increment and detached plain-data append/remove
operations on reactive fields. Internal replay folds data operations over the
confirmed base in invocation order; it never reruns application handlers.
Successful local operations remain in the journal until the last pending call
settles. An authoritative response advances the field sequence and excludes
operations that it confirms. This preserves later operations when an older
failure removes its entry, including a removal that was initially a no-op.
Later local replacements provide a base for subsequent operations.
Direct assignments retain absolute whole-field semantics. Mixing operations and
direct assignment on one field in a handler rejects and restores that capture.
Saved helpers reject after capture ends, including during a later invocation.
Field/item types use a concrete Host; polymorphic this needs an explicit class.
The runtime reactive metadata check remains authoritative.

A weak per-target history retains confirmed values only for fields whose later
user edit survives settlement. An equal ambient echo is ignored before pending
field merging, including when another call starts. Changed state and explicit
RPC reads clear that field's history. Socket/EventSource open and SSE resync clear
history without discarding active invocation ownership. For sources without cursor
metadata this remains duplicate-value recognition. SSE page publications correlate
request ownership and use event cursors to order ambient and action snapshots.
Older replies remove their own confirmed contribution without replacing newer public
state. A higher revision restores authority after settlement, even for equal values.
Child-local replies remain outside the page cursor domain. SQLite persists per-scope
cursors; Node/Deno use process publication IDs across SSR entry replacement. Reopen
resets the client baseline; this does not establish cross-process generation ordering.
Actual native SSE resync and socket reconnect acceptance now pass. Wider optimistic
stream/service cases remain RT-06 work.

Process runtime connection snapshots contain flat public state, matching normal
broadcasts and Cloudflare snapshots. SSR hydration remains a separate wrapped
record. Uncertain errors retain existing transport codes and cannot prove server
rollback. Mutation replay is forbidden; a record read or resource refresh supplies
application-specific authority when no realtime snapshot is available.

The Cloudflare SSE coordinator checks `X-Cossack-Rpc-Response: native` before
its RPC NDJSON MIME-type branch. A native body may contain arbitrary text/JSON/
binary data and must not be parsed as protocol frames even when its MIME type
matches. Opaque bodies retain the same serialization slot and response cleanup
lifetime. Built production Worker/Chromium fixtures cover multipart/public client
consumption, native bodies, redirect/flash cookies and D1-backed request ownership
through generator completion and scoped cleanup. Test-only D1 release/audit
endpoints belong solely to temporary acceptance applications.

## Client response cancellation ownership

Component HTTP/SSE calls and explicit-service calls share an abort-aware response
waiter. It observes the original request after cancellation, discards late responses
and releases their bodies. Client deadlines do not depend on a request producer
honoring abort. This does not terminate external I/O or prove server rollback.
Service optimistic/loading cleanup is idempotent and runs from explicit cancellation,
even before its generator first starts. Terminal/finally cleanup cannot release an
invocation twice. Confirmed yield state remains authoritative when a later frame
fails; unconfirmed client-only previews roll back. Late scoped consumers keep their
per-invocation ownership. See the [optimistic guide](../docs/optimistic.md#cancel-a-stream).


## Controlled UI data tables

The UI DataTable consumes a current page and an explicit total. Its parent owns
queries, server data access and stale-response handling. Query callbacks emit new
state without modifying rows or sorting/filtering them locally. Columns use typed
row keys or accessors. Selection is a controlled set of stable string IDs. Updates
copy the set and change only visible selectable rows, preserving off-page IDs.
Authorization and selection reconciliation remain application responsibilities.

The component uses native table and form controls. It publishes caption/row-label
requirements and explicit loading/error/empty semantics. Paging keeps focusable
aria-disabled controls and guards their handlers. Retry transfers focus before
its conditional button disappears. The library owns no database or framework
application dependency. UI declaration builds rewrite relative imports for strict
ESM consumers, as core and renderer already do.

Same-owner page replacement captures focus immediately before publication. A
unique DOM ID identifies the replacement control. Tag, type and name must match.
Text selection transfers only with an unchanged value. Retained nodes and
intentional focus moves take precedence. The same guarded restoration runs after
rollback rendering. Cross-owner navigation does not transfer focus. DataTable's
optional ID supplies stable IDs for its query and paging controls.
