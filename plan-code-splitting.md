# Plan - Code Splitting ✅

Currently, the rendered JavaScript bundle for Cossack is quite large. Which is not ideal for performance, harder to debug.
To improve this, we should implement code splitting strategies to reduce initial load times and improve overall performance.

## Goals

- Reduce the bundle size by splitting code per component or feature.
- Load only necessary code for the current view.

## Status: COMPLETED

## Implementation

**Changes Made:**

### 1. Modified vite-plugin.ts
Mode-aware lazy loading - pages are eager for SSR, lazy for client:
```typescript
const isSsr = options.mode === 'ssr';

// SSR: eager loading (synchronous access for server routes)
// Client: lazy loading (code splitting for performance)
const pages = import.meta.glob(['/src/pages/**/index.ts', '/src/pages/**/index.mdx'],
  isSsr ? { eager: true } : undefined
);
```

### 2. Updated client/app.ts
Modified `loadComponent()` to handle async page loading:
```typescript
// Dynamic import for page module (code splitting)
const pageModuleLoader = pages[componentPath];
const module = await pageModuleLoader(); // Async load
const PageComponent = Object.values(module)[0] as new () => Cossack;
```

### 3. Enhanced vite.client.config.ts
Added manual chunk splitting for better organization:
```typescript
manualChunks: (id) => {
  // Core framework chunks - our own packages
  if (id.includes('@cossackframework/core') || id.includes('@cossackframework/renderer')) {
    return 'cossack-framework';
  }
  // Vendor chunks for third-party libraries
  if (id.includes('node_modules')) {
    if (id.includes('marked') || id.includes('gray-matter')) {
      return 'vendor-markdown';
    }
    return 'vendor';
  }
}
```

## Results

### Bundle Structure:
```
Client (Code Split):
├── entry-client.[hash].js       ~66 KB  (Main entry + framework + layouts)
├── vendor.[hash].js              ~218 KB (Third-party libraries)
└── index.[hash].js (22 chunks)   ~0.2-4 KB each (Lazy-loaded pages)

SSR (Single Bundle):
└── dist/worker/index.js         ~158 KB (All pages for SSR)
```

### Benefits:
1. **Initial Load**: Only downloads entry-client + vendor + current page chunk
2. **Navigation**: Downloads only the new page chunk (cached separately)
3. **Better Caching**: Framework, vendor, and each page cached independently
4. **Faster Navigation**: Subsequent page loads only require fetching small page chunks
5. **No SSR impact**: Server keeps single bundle for synchronous access

### Manifest Example:
```json
{
  "entry-client.ts": {
    "file": "assets/entry-client.[hash].js",
    "dynamicImports": [
      "src/pages/index/index.ts",
      "src/pages/hello/[name]/index.ts",
      ...
    ]
  },
  "src/pages/index/index.ts": {
    "file": "assets/index.[hash].js",
    "isDynamicEntry": true,
    "imports": ["entry-client.ts", "vendor.js"]
  }
}
```

---

## Proposed Strategies

Currently, we rendered into two main bundles: `@packages/framework/dist/client/entry-client.js` and `@packages/framework/dist/worker/index.js`.

For the server-side worker, we can keep a single bundle since it runs in a controlled environment.
For the client-side, we need somehow to split the code, maybe:

- `common.js`: shared utilities and libraries.
- `page-[name].js`: individual component code.

So, when navigating to a specific page, only the relevant `page-[name].js` is loaded alongside `common.js`.

You can achieve this using dynamic imports or whatever technique supported by our build tool (e.g., Webpack, Vite).

## Discussion
Let me know your thoughts on this approach or if you have other suggestions for code splitting strategies!