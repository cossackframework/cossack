# View Transitions

Cossack supports the browser [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) for smooth, animated transitions between pages and between states within the same page. This feature is **opt-in** — it has zero impact on existing apps unless you enable it.

## Enabling View Transitions

Pass `viewTransitions: true` to `createClientApp` in your `entry-client.ts`:

```typescript
createClientApp({ container: '#root', viewTransitions: true });
```

When enabled and the browser supports the API (`document.startViewTransition`), SPA navigations automatically wrap their DOM commit phase in a view transition. On unsupported browsers (e.g., Firefox at the time of writing), navigation still works — just without animation.

## How It Works

When a user clicks a link and navigates between pages:

1. The framework fetches the new page data (network request happens normally).
2. The old page is destroyed and the new page is instantiated.
3. **This DOM commit step is wrapped inside `document.startViewTransition()`**, so the browser snapshots the old and new states and crossfades between them.
4. The loading.ts swap (if any) happens *before* the transition snapshots — so the transition animates from your loading skeleton to the real content.

## Per-Link Transition Types

You can tag individual links with transition types using the `data-transition-types` attribute. This lets you apply different animations per navigation direction (e.g., forward vs. back).

```html
<a href="/photo/42" data-transition-types="nav-forward">View photo</a>
<a href="/" data-transition-types="nav-back">Back</a>
```

Then target these types in your CSS:

```css
@media (prefers-reduced-motion: no-preference) {
    ::view-transition-old(.nav-forward) {
        animation-name: slide-out-left;
        animation-duration: 0.4s;
        animation-timing-function: ease-in;
        animation-fill-mode: both;
    }
    ::view-transition-new(.nav-forward) {
        animation-name: slide-in-right;
        animation-duration: 0.4s;
        animation-timing-function: ease-out;
        animation-fill-mode: both;
    }
}

@keyframes slide-out-left { to { transform: translateX(-100%); } }
@keyframes slide-in-right { from { transform: translateX(100%); } }
```

> **Important:** Put view-transition CSS in a **global stylesheet** (e.g., `src/style.css`), not in component-scoped `<style>` tags. During SPA navigation, the old page component is destroyed before the transition animation plays — its `<style>` tags are removed from the DOM at that point. The `::view-transition-old/new` pseudo-elements exist at the document root during animation playback and need the CSS to persist.

You can pass multiple types by separating them with whitespace:

```html
<a href="/dashboard" data-transition-types="nav-forward expand">Dashboard</a>
```

## Programmatic Navigation with Types

When calling `this.redirect()` on the client, you can pass transition types via an options object:

```typescript
// Redirect with a custom transition type
this.redirect('/dashboard', { types: ['nav-forward'] });

// Redirect with both status and types
this.redirect('/login', { status: 302, types: ['fade'] });
```

The original `redirect(url, status)` signature still works unchanged.

## Same-Page Transitions

For animating state changes within the same route (tab switches, list reordering, expanding a panel), use `this.startViewTransition()`. This wraps a callback in a view transition without triggering a navigation.

```typescript
import { Page, Cossack, Client, ClientState } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class Tabs extends Cossack {
    @ClientState() activeTab = 'overview';

    @Client()
    switchTab(name: string) {
        this.startViewTransition(() => {
            this.activeTab = name;
        });
    }

    render() {
        return html`
            <button @click=${() => this.switchTab('overview')}>Overview</button>
            <button @click=${() => this.switchTab('details')}>Details</button>
            <div class="tab-content">
                ${this.activeTab === 'overview'
                    ? html`<p>Overview content</p>`
                    : html`<p>Details content</p>`}
            </div>
        `;
    }
}
```

You can also pass transition types to scope CSS animations to specific interactions:

```typescript
this.startViewTransition(() => { this.expanded = !this.expanded; }, ['expand']);
```

```css
@media (prefers-reduced-motion: no-preference) {
    ::view-transition-old(.expand) {
        animation-name: collapse;
        animation-duration: 0.15s;
        animation-timing-function: ease-in;
        animation-fill-mode: both;
    }
    ::view-transition-new(.expand) {
        animation-name: expand;
        animation-duration: 0.2s;
        animation-timing-function: ease-out;
        animation-fill-mode: both;
    }
}
```

### Server-Side Behavior

`this.startViewTransition()` is safe to call on the server — it simply runs the callback directly with no transition. This means you can use it in shared methods without environment checks.

## Named Elements (Morph)

For elements that should morph or persist across transitions (e.g., a card image that expands into a detail header), add `view-transition-name` in CSS. The browser automatically snapshots and animates any element with this property.

**List page:**
```css
.card-image-1 { view-transition-name: item-1; }
.card-image-2 { view-transition-name: item-2; }
```

**Detail page:**
```css
.detail-header { view-transition-name: item-1; }
```

When both pages have an element with the same `view-transition-name`, the browser morphs between them instead of crossfading. This works for both navigation transitions and same-page transitions.

## Reduced Motion

When `viewTransitions: true` is set, the framework automatically injects a `<style>` tag that disables all transition animations under `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
    ::view-transition-old(*),
    ::view-transition-new(*),
    ::view-transition-group(*) {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
    }
}
```

This makes the feature accessible by default. Users who want partial motion can override these rules in their own CSS.

## Browser Back/Forward

Browser-initiated back/forward navigation (the browser's back button, `history.back()`) does **not** carry transition types. This matches the behavior of other frameworks — there's no reliable cross-browser signal for "back" navigation. If you need to detect navigation direction, use the `cossack:ready` event's `navigationType` field.

## Graceful Fallback

If the browser does not support the View Transitions API, everything still works — navigation and state changes happen normally, just without animation. No errors are thrown, and no degraded behavior occurs.
