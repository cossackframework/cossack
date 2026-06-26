---
title: "Performance Optimizations"
description: "Built-in optimizations including instant navigation with smart pre-fetching, client-side caching, and automatic progress bars."
---

# Performance Optimizations

Cossack is built for speed. Beyond its edge-native architecture, it includes several automatic optimizations to make your application feel instantaneous to the end-user.

## 1. Instant Navigation

Cossack's client-side router (Soft Navigation) is enhanced with two key features that eliminate perceived network latency.

### Smart Pre-fetching
When a user hovers their mouse over a link (`<a>`), Cossack assumes they are likely to click it. After a 50ms hover delay, the framework automatically begins fetching the data for that page in the background.

By the time the user actually clicks the link (typically 100ms-300ms later), the data is often already downloaded, resulting in an **instant transition**.

### Client-Side Caching
Cossack maintains a memory-based cache of all visited and pre-fetched pages.
- **Instant Back/Forward**: Clicking the browser's back or forward buttons is instantaneous because the state is restored directly from the cache.
- **Zero Network Re-visits**: Re-visiting a page you've already seen in the current session requires zero network requests.

## 2. Navigation Progress Bar
For slow network conditions or large data fetches where pre-fetching isn't enough, Cossack automatically displays a sleek, non-intrusive progress bar at the top of the viewport.

This gives the user immediate visual feedback that their navigation is in progress, improving the perceived reliability of the application.

## 3. Optimistic UI Updates
With the `@Optimistic` decorator, you can eliminate the "waiting for server" feel for interactive actions.

```typescript
@Optimistic('increment')
applyOptimisticIncrement() {
    this.count++; // Updates the UI instantly!
}
```

When the server eventually broadcasts the "true" state, Cossack seamlessly overwrites the optimistic state with the verified value from the server. See the [State Management Guide](./states.md) for more details.

## 4. Image Optimization
The built-in `Image` helper ensures your assets are served in modern formats (like WebP/AVIF) and at the correct size for the user's screen, reducing page weight and improving Core Web Vitals. See the [Image Optimization Guide](./image.md) for more details.
