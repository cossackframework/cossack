---
title: "Prevent Navigation"
description: "Intercept and block client-side navigation to warn users about unsaved changes using the @PreventNavigation decorator."
---

# Prevent Navigation

Cossack can intercept and block client-side navigation. Use it to warn users about unsaved changes or to run other guards before they leave the current page.

## The `@PreventNavigation` Decorator

Add the `@PreventNavigation` decorator to a component method. Return `true` to block navigation. Return `false` or nothing to allow it.

> Return `true` when the method must prevent navigation.

## Handling the Blocked Navigation

When navigation is blocked, Cossack sets the internal `_pendingNavigation` property. You can read this property in your `render` method to display a custom UI, such as a modal.

To resolve the pending navigation, call `this.confirmNavigation(boolean)`:
* `confirmNavigation(true)`: Proceed with the navigation (leave the page).
* `confirmNavigation(false)`: Cancel the navigation (stay on the page).

## Example

```typescript
import { Cossack, Page, State, PreventNavigation } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class UnsavedForm extends Cossack {
    @State() isDirty = false;

    @PreventNavigation()
    shouldBlock() {
        return this.isDirty;
    }

    render() {
        return html`
            <h1>Form</h1>
            <input @input=${() => this.isDirty = true} />

            ${this._pendingNavigation ? html`
                <div class="modal">
                    <p>Unsaved changes! Leave anyway?</p>
                    <button @click=${() => this.confirmNavigation(true)}>Yes</button>
                    <button @click=${() => this.confirmNavigation(false)}>No</button>
                </div>
            ` : ''}
        `;
    }
}
```

## How it Works

1. Interception: When a user clicks a link managed by Cossack's client-side router, the framework checks the current page for any `@PreventNavigation` handler.
2. Evaluation: The handler is executed. If it returns `true` (or a Promise resolving to `true`), the navigation is halted.
3. State Update: The blocked navigation action is stored in `_pendingNavigation` and `_render()` is triggered to allow your UI to react.
4. Resolution: `confirmNavigation(true)` runs the stored action without checking again. `confirmNavigation(false)` clears the pending state.


## Navigation completion contract

On the client, `await this.navigate(url, options)` returns a typed outcome after
the page render, history change, and scroll update. Applications that call
`createClientApp()` directly can also use its returned `navigate` function.

| Outcome | Meaning |
| --- | --- |
| `completed` | The page rendered, history updated, scroll policy applied. |
| `redirected` | The server redirected during the fetch. `url` includes the final path, query, and fragment. |
| `superseded` | A newer navigation took ownership. Revoked work cannot publish further changes. |
| `canceled` | A `preventNavigation` handler stopped this navigation. |
| `failed` | The fetch or render threw after the error event. `error` carries the cause. |

```ts
const result = await this.navigate('/dashboard');
if (result.outcome === 'superseded') return; // a newer navigation owns the UI
```

Guards that throw produce `failed`. After revocation, old work cannot update
history or emit completion events. A destination committed before a newer intent
remains a valid history entry. New page and layout bootstrap runs before publication,
outside the commit queue. A stalled old bootstrap cannot block a newer page.
The old page stays alive until the new tree renders and history commits.
Before that commit, failure or cancellation restores the page, layout map,
request contexts, resource entries and global SSR state. Unresolved restored
resource reads can reload instead of joining discarded results. After commit,
cleanup or completion-hook errors leave the committed destination current.
Use `redirect()` in server methods.

Navigation has one 30-second completion budget across asynchronous guards, fetch,
imports, preparation, rendering and transition completion. Expiry revokes its
publication authority and reports `COSSACK_NAVIGATION_TIMEOUT`. A history
restoration after failure has its separate two-second limit. If the application
prevents the default action of the cancelable `cossack:navigation-error` event,
navigation returns `failed`. Otherwise the existing reload fallback runs.

The deadline settles the framework's wait. It cannot stop arbitrary application
I/O or synchronous blocking code. It cannot undo effects from a custom render or
mount hook that already ran. Before publication, the renderer captures declared
drafts from the rendered child tree. Rollback restores them into matching fresh
owners before mount. Destroyed children stay destroyed. Inactive cached branches
retain local draft capabilities until a matching branch is shown, including
across another navigation.

During rollback, abandoned components become destroyed and cancel their tasks
immediately. During both rollback and successful retirement, their owned service
scopes stay available until the renderer removes their child consumers and those
consumers finish asynchronous cleanup. New consumers cannot attach to a retiring
scope. This lifetime hold does not extend
the navigation deadline or impose a deadline on application cleanup. Ordinary
explicit component destruction keeps its normal behavior.

Navigation uses a core-owned render pass and does not join an unrelated pending
App update promise. It calls the normal render/controller lifecycle and reports
render errors through the navigation failure path. Returning false from the App's
shouldUpdate hook reports `COSSACK_NAVIGATION_RENDER_SKIPPED`. Customize render
and lifecycle hooks rather than using requestUpdate or performUpdate overrides
as navigation synchronization hooks.

Page fetches share requests with prefetches, but each reader owns its wait.
A newer navigation releases the old navigation's reader immediately. The request
is aborted when no readers remain. Another prefetch or navigation can continue
reading the same request. Abandoned responses cannot repopulate the page cache.
Each reader also has a separate 30-second response/body deadline with code
`COSSACK_NAVIGATION_FETCH_TIMEOUT`. The earlier whole-navigation deadline normally
wins for navigation readers. Independent prefetch readers keep their own budget.

## Guards during back and forward

Browsers activate a history entry before Cossack can check its guard. For entries
created by the current Cossack app, a blocked traversal restores the entry it
left. The visible page, local drafts, scroll metadata and application history
state stay intact. The restoration event does not run the guard again or fetch
another page.

`confirmNavigation(true)` resumes the original back/forward entry and bypasses
the guard once. It does not create a new history entry. Canceling the confirmation
keeps the restored page. A failed page fetch or module import during traversal
also restores the previous owned entry before the navigation error event.

Entries carry a private group and position under `__cossackNavigation`. Preserve
that namespace when changing `history.state`. Cossack does not invent positions
for foreign or overwritten entries. If it cannot restore an owned entry, or the
expected browser event does not arrive within two seconds, navigation reports
`failed` with `COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED`. Applications can handle
the existing cancelable `cossack:navigation-error` event.

Module imports resolve before the framework changes the live page or layout
contexts. A superseded page/layout import cannot publish its state. This does
not undo arbitrary application effects after publication. Distinct same-URL
entries retain their owned history positions during restoration and confirmation.
A newer intent waits for pending restoration, while a newer navigation can
supersede a confirmed traversal that is still fetching. A late response cannot
overwrite its replacement.

## Development diagnostics

In development builds, listen on `document` for `cossack:navigation-diagnostic`.
The event detail is a frozen, versioned record. It has `version: 1`, a numeric
`navigationId`, a `performance.now()` timestamp, and one phase from the table below.
IDs distinguish concurrent navigations within the current document. Prefetch cache
decisions and cache invalidation use `navigationId: null`.

```typescript
document.addEventListener('cossack:navigation-diagnostic', event => {
    console.debug((event as CustomEvent).detail);
});
```

| Phase | Fields and meaning |
| --- | --- |
| `start` | `navigationType`: `push`, `replace` or `traverse`. |
| `cache` | `decision`: `hit`, `miss` or `shared` with an in-flight reader. |
| `invalidate` | `entries`: number of cached documents cleared, including the initial document. |
| `layouts` | `retained`, `created`, `retired` counts and `rootReplaced` for the commit attempt. |
| `scroll` | Requested `behavior` and actual `decision`: `preserve`, `history`, `top`, `fragment`, `fragment-missing` or `unavailable`. |
| `transition` | `decision`: `disabled`, `unsupported`, `callback`, `typed`, `types-unsupported` or `animation-skipped`. |
| `finish` | Navigation `outcome` and `committed`: whether destination history was committed. |

A normal navigation emits start, cache, transition, layouts, scroll and finish.
A guard can cancel before fetching. A failure can stop before scrolling. Layout
counts describe an attempted commit. A later failure can roll it back. Animation
rejection does not fail a committed navigation. Its `animation-skipped` event can
arrive after finish because animation completion has a separate lifetime.
`fragment-missing` means the target was absent and the viewport moved to the top.

The stream excludes URLs, query/fragment values, user data, drafts, application
identifiers, transition names and raw errors. Production builds emit no diagnostic
events. Existing lifecycle/error events keep their own contracts. Initial hydration
and rejected stale URL-update requests do not create navigation traces.
