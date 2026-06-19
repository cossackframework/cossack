# GIF84 Migration — Fix List

Findings from converting GIF84 to Cossack 0.5.1.
Following are issues found on Cossack 0.5.1 when we dog fooding Cossack. Based on our architecture, please check and fix accordingly.

## F-P0 — Silent stubbing of helper methods called from lifecycle hooks

### Symptoms

A developer extracts a private helper method on a component and calls it from
`onMount()` (or any other preserved method). On the client the call **silently
no-ops** — no error, no warning, the method body never executes. Sections of the
page that depend on the helper's side effects stay blank.

In the GIF84 migration this manifested as: scroll-reveal elements never received
the `.revealed` class, so every animated section was invisible (`opacity: 0`).

### Reproduction

```typescript
export class App extends Cossack {
    onMount() {
        super.onMount();
        this.setupObservers();        // silently does nothing on the client
    }

    private setupObservers() {         // no decorator, not a builtin
        console.log('running');        // never prints
        new IntersectionObserver(...);
    }
}
```

Type-checks fine. Works on the server. On the client `setupObservers` is a stub;
calling it hits an auto-generated RPC proxy that calls a non-existent server
method and silently returns `undefined`.

### Root cause

Two mechanisms combine into a trap:

1. **Default-deny method stripping** —
   `packages/framework/src/vite-security-plugin.ts:1024-1045`
   (`isClientSafeMethod`):
   ```ts
   // Default: methods without decorators are considered server-only (secure by default)
   return false;
   ```
   Any method without a client-safe decorator (`@Client`, `@On`, `@OnWindow`,
   `@OnDocument`, `@Computed`, …) or a builtin name (`onMount`, `onNavigateComplete`,
   `render`, …) is classified "server-only".

2. **Stub + auto-proxy** —
   `packages/framework/src/vite-security-plugin.ts:520-526` calls `createStub`
   (line 993-1010). `createMetadataInjection` (line 382-402) then registers every
   stubbed method name into `cossack:server-methods` metadata with
   `__serverOnly: true`. During bootstrap the framework reads this metadata and
   installs RPC proxies for those names. So the call path on the client becomes:
   `this.setupObservers()` → proxy intercepts → RPC to server → server has no
   such method → silent failure.

The dev-mode stub (line 998-1010) was *intended* to throw, but the proxy
short-circuit (`if (proxy) { return proxy.apply(this, arguments); }`) defeats it
whenever a proxy was registered — which is always, because
`createMetadataInjection` registers every stubbed method.

### Fix options

#### Option A (recommended, long-term): Transitive preservation

Statically detect which methods are reachable from preserved (client-safe)
methods and preserve them too. A method called from `onMount()` must itself be
client-safe, because `onMount` is.

**File:** `packages/framework/src/vite-security-plugin.ts`, function
`transformMethodsWithDepthTracking` (line 408-540).

1. First pass: identify all client-safe methods (builtins + decorated), as today.
2. Second pass: scan each preserved method's body for `this.<name>(` calls. Add
   matched names to the client-safe set. Repeat to a fixed point (cap at 2-3
   levels) to handle indirect calls.
3. Third pass: stub only what remains.

This preserves the security guarantee (genuinely server-only methods are still
stripped) while eliminating the trap for internal helpers.

#### Option B (recommended, short-term): Make the failure loud

One-file change. In `createStub` (`packages/framework/src/vite-security-plugin.ts:993`),
stop honouring the proxy for non-`@Server` methods:

```ts
// createStub, dev branch — current:
const proxy = this.__cossack_proxies?.get('${methodName}');
if (proxy) { return proxy.apply(this, arguments); }
throw new Error(...);

// Proposed: only honour the proxy for real @Server methods
const proxy = this.__cossack_proxies?.get('${methodName}');
if (proxy && proxy.__realServerMethod) { return proxy.apply(this, arguments); }
throw new Error(
  '[Cossack] ' + '${className}.${methodName}' + ' was stripped from the client bundle ' +
  'because it has no client-safe decorator. Add @Client, @On, @OnWindow, @OnDocument, ' +
  '@Computed, or mark it as a builtin, OR avoid calling it from client code.'
);
```

And in `createMetadataInjection` (line 382-402), **do not** register stubbed
methods as `server-methods` unless they were actually decorated with `@Server`.
Today every stubbed method is registered, which is what causes the silent proxy
path.

#### Option C (addition): `@ClientSide()` decorator

Add `@ClientSide()` to `packages/core/src/shared/decorators.ts` — marks a method
as client-only internal plumbing: preserved in the client bundle, no-op on the
server, NOT registered as an RPC method. Document as the decorator to use for
helpers called from lifecycle hooks.

**Recommendation:** ship **Option B** immediately (unblocks everyone), track
**Option A** as the proper fix, and add **Option C** regardless.

### Recommended tests

Add to `packages/framework/tests/vite-security-plugin.test.ts`:

```ts
describe('transitive preservation / loud failure', () => {
  it('does not silently no-op a helper called from onMount', () => {
    const code = `
      class App extends Cossack {
        onMount() { this.helper(); }
        helper() { return 42; }
      }
    `;
    const out = transformCossackClass(code, 'App.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    // Either helper is preserved (Option A)...
    expect(out).toContain('return 42');
    // ...or its stub throws and does not silently proxy (Option B):
    const match = out.match(/helper\(\)\s*{([^]+?)}/);
    expect(match[1]).toContain('throw');
    expect(match[1]).not.toMatch(/return proxy\.apply/);
  });

  it('still stubs genuine @Server methods', () => {
    const code = `
      class App extends Cossack {
        @Server() queryDb() { return realDb.query(); }
      }
    `;
    const out = transformCossackClass(code, 'App.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(out).not.toContain('realDb.query');
  });

  it('does not auto-RPC-register stripped helpers', () => {
    const code = `
      class App extends Cossack {
        onMount() { this.helper(); }
        helper() { /* private plumbing */ }
      }
    `;
    const out = transformCossackClass(code, 'App.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(out).not.toMatch(/__serverOnly:\s*true[^}]*helper/);
  });
});
```

Plus an end-to-end Playwright test that loads a page with the scroll-reveal
pattern and asserts `.revealed` is applied after scrolling — the exact
regression this bug caused in GIF84.

---

## F-P1 — Production build fails: SSR env imports client manifest before it exists

### Symptoms

`vite build` fails with:

```
[UNLOADABLE_DEPENDENCY] Could not load dist/client/.vite/manifest.json
  packages/framework/dist/esm/router.js:20
  const manifestModule = await import('~/.vite/manifest.json');
```

All modules transform successfully; the failure is at bundle time when the SSR
environment tries to resolve `~/.vite/manifest.json` (aliased to
`dist/client`) before the client environment has generated it.

### Root cause

**File:** `packages/framework/src/router.ts` (built to `dist/esm/router.js`).

A top-level `await import('~/.vite/manifest.json')` runs at module-evaluation
time. With Vite's multi-environment build, the `client` and `ssr` environments
build concurrently, so there is no guarantee the client environment (which emits
the manifest) finishes first.

### Fix (recommended)

Lazy-load the manifest inside a function so it resolves at runtime, not at
bundle time:

**File:** `packages/framework/src/router.ts`

```ts
// replace top-level await import
let _manifest: any;
export async function getManifest() {
  if (!_manifest) {
    _manifest = (await import('~/.vite/manifest.json' as string)).default;
  }
  return _manifest;
}
```

This decouples bundling from runtime and lets both environments build in any order.

### Recommended tests

Add to `packages/framework/tests/build.test.ts`:

```ts
describe('production build', () => {
  it('vite build succeeds for a multi-environment app', async () => {
    const result = await runBuild('./fixtures/multi-env-app');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('manifest.json');
  });

  it('router resolves the manifest lazily at runtime', async () => {
    const router = await import('../dist/esm/router.js');
    expect(typeof router.getManifest).toBe('function');
  });
});
```

---

## F-P2 — `@VisibleTask` callback receives no element argument

### Symptoms

`@VisibleTask({ selector: '.item' })` is documented as firing when an element
matching the selector enters the viewport, but the decorated method receives
**no argument** — there is no way to know *which* element triggered the task.
This makes the decorator unusable for the common "do something to the element
that just scrolled into view" pattern (per-item animation, lazy-init a specific
node, etc.).

Additionally, the observer disconnects after the **first** matching element
intersects, so even with `refreshVisibleTasks` adding new elements on
navigation, only the first intersection per task fires the callback.

### Root cause

**File:** `packages/core/src/shared/cossack.ts:798-828`

```ts
const execute = () => {
  const method = this.getMethod(propertyKey);
  const cleanup = (method as any)();   // <-- called with no arguments
};
// ...
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    execute();
    observer.disconnect();              // <-- runs once, then stops
  }
}, { threshold: options.threshold || 0 });
```

### Fix

**Files:**
- `packages/core/src/shared/cossack.ts` (line 825-830) — pass the element, unobserve per-element.
- `packages/core/src/shared/decorators.ts` (line 467-480) — declare the parameter type.

```ts
// cossack.ts — setupVisibleTasks()
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const method = this.getMethod(propertyKey);
      try {
        (method as any).call(this, entry.target, entry);
      } catch (e) {
        console.error(`[Cossack] Error in visible task '${String(propertyKey)}':`, e);
      }
      observer.unobserve(entry.target);   // unobserve THIS element, not all
    }
  }
}, { threshold: options.threshold || 0 });
```

```ts
// decorators.ts
export type VisibleTaskMethod = (
  target: Element,
  entry: IntersectionObserverEntry
) => void | (() => void);
```

Backward compatible: methods that declare zero parameters still work (extra
arguments are ignored by JS).

### Recommended tests

Add to `packages/core/tests/visible-task.test.ts`:

```ts
describe('@VisibleTask selector callbacks', () => {
  it('passes the intersecting element to the method', async () => {
    let received: Element | null = null;
    @Page() class C extends Cossack {
      @VisibleTask({ selector: '.target' })
      task(el: Element) { received = el; }
    }
    const host = render(`<div class="target"></div>`);
    mount(C, host);
    await nextFrame();
    expect(received).toBe(host.querySelector('.target'));
  });

  it('fires once per matching element, not once globally', async () => {
    const hits: Element[] = [];
    @Page() class C extends Cossack {
      @VisibleTask({ selector: '.target' })
      task(el: Element) { hits.push(el); }
    }
    const host = render(`<div class="target"></div><div class="target"></div>`);
    mount(C, host);
    await nextFrame();
    expect(hits).toHaveLength(2);
  });
});
```

---

## F-P2 — Docs: make the method-stripping rule first-class

### Problem

The default-deny stripping rule (F-P0 above) is the single biggest hidden
footgun in the framework, yet it is not called out prominently in the docs.
Developers learn it only after a silent failure.

### Fix

**File:** `docs/` — add a new page `docs/client-bundle.md` and link to it from
`docs/components.md`, `docs/tasks.md`, and Getting Started.

Cover:
1. The rule: undecorated, non-builtin methods on `Cossack`/`CossackElement`
   subclasses are stripped from client bundles.
2. The builtin allowlist: `render`, `head`, `onMount`, `onCleanup`,
   `onNavigateComplete`, `escapeHtml`, `loadingTemplate`, `toString`, `valueOf`,
   `clientInit`, plus the validation helpers
   (`packages/framework/src/vite-security-plugin.ts:29-46`).
3. The client-safe decorators: `@Client`, `@On`, `@OnDocument`, `@OnWindow`,
   `@Computed`, `@Optimistic`, `@Shared`, `@PreventNavigation`, `@Validate`
   (`packages/framework/src/vite-security-plugin.ts:1030-1032`).
4. The failure mode (with the silent-proxy caveat from F-P0).
5. The workaround: inline helpers into lifecycle methods, or wait for the
   `@ClientSide` decorator / transitive preservation.

---