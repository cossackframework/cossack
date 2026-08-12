---
title: "View Transitions"
description: "Browser View Transitions API support for animated page and state changes, including navigation scroll behavior."
---

# View Transitions

Cossack supports the browser [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) for smooth, animated transitions between pages and between states within the same page. This feature is **opt-in** — it has zero impact on existing apps unless you enable it.

## Enabling View Transitions

Pass `viewTransitions: true` to `createClientApp` in your `entry-client.ts`:

```typescript
import { createClientApp } from '@cossackframework/framework/client/app';
import { App } from '../App';

createClientApp({
    container: '#root',
    AppComponent: App,
    viewTransitions: true,
});
```

When enabled and the browser supports the API (`document.startViewTransition`), SPA navigations automatically wrap their DOM commit phase in a view transition. On unsupported browsers, navigation still works without animation.

## Navigation Progress Bar

Enable a slim progress bar at the top of the page that fills during SPA navigations — the same UX pattern popularized by NProgress and Next.js:

```typescript
createClientApp({
    container: '#root',
    AppComponent: App,
    viewTransitions: true,
    progressBar: true,
});
```

The bar appears at 30% when a navigation starts and completes to 100% when the new page is ready. No additional configuration or CSS is needed — the framework injects everything automatically. Both `viewTransitions` and `progressBar` are independent options; use either or both.

## How It Works

When a user clicks a link and navigates between pages:

1. The framework fetches the new page data (network request happens normally).
2. The browser snapshots the current state through `document.startViewTransition()`.
3. Inside the transition update callback, Cossack destroys the old page, instantiates the new page, commits its DOM, and applies its scroll position.
4. The browser snapshots the committed destination and animates between the two states.

The loading.ts swap (if any) happens before the view transition starts, so the transition animates from your loading skeleton to the real content.

## Navigation Scroll Behavior

Scroll behavior belongs to SPA navigation and works the same way whether View Transitions are enabled or disabled. The default policy is `auto`:

| Navigation | `auto` behavior |
|---|---|
| New link or client redirect | Scroll to the URL fragment, or to the top when there is no matching fragment |
| Browser back/forward | Restore the position saved for that history entry |

You can set the app-wide policy in `entry-client.ts`:

```typescript
createClientApp({
    container: '#root',
    AppComponent: App,
    viewTransitions: true,
    navigation: { scroll: 'auto' },
});
```

Available policies are:

- `auto` — browser-like fragment, top, and history-restoration behavior. This is the default.
- `top` — always scroll to the top, including during back/forward traversal.
- `preserve` — leave the current viewport position unchanged.

Override the policy for an individual link with `data-scroll`:

```html
<a href="/articles?page=2" data-scroll="preserve">Next page</a>
```

Programmatic navigation accepts the same override:

```typescript
this.redirect('/articles?page=2', { scroll: 'preserve' });
```

When View Transitions are enabled, Cossack applies the destination scroll position inside the transition update callback. The new snapshot therefore represents the destination at its final scroll position.

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

## Programmatic Navigation Options

When calling `this.redirect()` on the client, you can combine transition types and scroll behavior in one options object:

```typescript
// Redirect with a custom transition type
this.redirect('/dashboard', { types: ['nav-forward'] });

// Preserve scroll while using a custom transition
this.redirect('/dashboard?tab=activity', {
    types: ['tab-forward'],
    scroll: 'preserve',
});

// Server redirects can still include an HTTP status
this.redirect('/login', { status: 302, types: ['fade'], scroll: 'top' });
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

Browser-initiated back/forward navigation does not carry transition types, but Cossack marks it as history traversal and restores its saved scroll position under the default `auto` policy.

The `cossack:ready` event exposes the navigation kind through `event.detail.navigationType`:

- `initial` — initial hydration.
- `push` — a link or programmatic client navigation.
- `traverse` — browser back/forward navigation.

## Closing Transient UI During Navigation

Persistent layouts keep their client state between pages. Close transient UI such as a mobile navigation sheet when navigation begins, with navigation completion as a fallback:

```typescript
import { ClientState, OnDocument } from '@cossackframework/core';

@ClientState() mobileNavigationOpen = false;

@OnDocument('cossack:before-navigate')
closeMobileNavigationBeforeNavigate() {
    this.mobileNavigationOpen = false;
}

onNavigateComplete() {
    this.mobileNavigationOpen = false;
}
```

Using the built-in event decorator and lifecycle hook keeps the listeners scoped to the component and ensures an open sheet is not carried into the destination page.

## Graceful Fallback

If the browser does not support the View Transitions API, everything still works — navigation and state changes happen normally, just without animation. No errors are thrown, and no degraded behavior occurs.
