---
title: "Performance Optimizations"
description: "Built-in optimizations including instant navigation with smart pre-fetching, client-side caching, and automatic progress bars."
---

# Performance Optimizations

Cossack runs at the edge. It also includes automatic optimizations that reduce waiting for the user.

## 1. Instant Navigation

Cossack's client-side router (soft navigation) has two features that remove perceived network latency.

### Smart Pre-fetching
When a user hovers the mouse over a link (`<a>`), Cossack starts to fetch the data for that page in the background after a 50 ms hover delay.

The user typically clicks the link 100 ms to 300 ms later. The data is often downloaded by then, so the transition is instant.

### Client-Side Caching
Cossack maintains a memory-based cache of all visited and pre-fetched pages.
- Fast back and forward: the browser restores the page state directly from the cache.
- No network re-visits: a page that the user already saw in the current session loads without network requests.

## 2. Navigation Progress Bar
For slow network conditions or large data fetches where pre-fetching is not enough, Cossack automatically displays a progress bar at the top of the viewport.

The bar gives the user immediate visual feedback that the navigation is in progress.

## 3. Optimistic UI Updates

The `@Optimistic` decorator removes the "waiting for server" feel for interactive actions.

```typescript
@Optimistic('increment')
applyOptimisticIncrement() {
    this.count++; // Updates the UI instantly!
}
```

When the server broadcasts the confirmed state, Cossack replaces the optimistic state with that value. See the [State Management Guide](./states.md) for details.

## 4. Image Optimization

The built-in `Image` helper serves your assets in modern formats (WebP or AVIF) and at the correct size for the user's screen. This reduces page weight and improves Core Web Vitals. See the [Image Optimization Guide](./images.md) for details.

The `cossack image:optimize` CLI command optimizes images in your `public` folder. The command scans for `Image({ ... })` helper calls in your project and optimizes local `src` assets.
It saves the optimized images next to the original image in WebP or AVIF format (`--format webp|avif`).
