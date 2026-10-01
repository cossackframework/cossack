---
title: "Prevent Navigation"
description: "Intercept and block client-side navigation to warn users about unsaved changes using the @PreventNavigation decorator."
---

# Prevent Navigation

Cossack provides a way to intercept and block client-side navigation, allowing you to warn users about unsaved changes or perform other checks before they leave the current page.

## The `@PreventNavigation` Decorator

Add the `@PreventNavigation` decorator to a component method. Return `true` to **block** navigation. Return `false` or nothing to allow it.

> Return `true` when the method must prevent navigation.

## Handling the Blocked Navigation

When navigation is blocked, Cossack sets the internal `_pendingNavigation` property. You can check this property in your `render` method to display a custom UI (like a modal).

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

1. **Interception**: When a user clicks a link managed by Cossack's client-side router, the framework checks the current page for any `@PreventNavigation` handler.
2. **Evaluation**: The handler is executed. If it returns `true` (or a Promise resolving to `true`), the navigation is halted.
3. **State Update**: The blocked navigation action is stored in `_pendingNavigation` and `_render()` is triggered to allow your UI to react.
4. **Resolution**: `confirmNavigation(true)` runs the stored action without checking again. `confirmNavigation(false)` clears the pending state.
