---
title: 'Metadata Management (Head)'
description: 'Control document head tags like title, meta, script, and link dynamically with automatic inheritance from layouts using the head method.'
---

# Metadata Management (Head)

Cossack provides a simple yet powerful API for managing the document's `<head>` section directly from your components. This allows you to control tags like `<title>`, `<meta>`, `<script>`, and `<link>` dynamically with automatic inheritance from layouts.

## Basic Usage

To manage head tags, override the optional `head()` method in your component. This method receives a `HeadContext` and should return a `HeadValue` object.

The framework automatically merges metadata from the **inside out**:
`Page` -> `Layouts` -> `Global App`.

### The `head()` Signature

```typescript
public head(context: HeadContext): HeadValue {
    return {
        title: 'My Page Title',
        meta: [
            { tag: 'meta', attributes: { name: 'description', content: 'Page description' } }
        ]
    };
}
```

### Automatic Merging Logic

Cossack merges metadata from the **inside out**: `Page` → `Layouts` → `Global App`.

- `title`, `description`, `image`: the child value wins unless a parent
  overrides it (`parentValue ?? childValue`).
- `meta`, `links`, `scripts`, `tags`: **accumulate** — the child's tags are kept
  and the parent's tags are appended. This means a root `App` can contribute
  global tags (e.g. font `<link>`s) without discarding page-specific tags such
  as a canonical link.

> As of `0.6.0` the array categories accumulate instead of replacing. Previously
> returning `meta`/`links` at a parent level replaced the child's array.

#### Example: Root Branding + global fonts in `App.ts`

```typescript
// src/App.ts
public head(context: HeadContext): HeadValue {
    return {
        // title is overridden (parent wins)
        title: `My App - ${context.title || 'Welcome'}`,
        // links ACCUMULATE — these appear alongside each page's own <link>s
        links: [
            { tag: 'link', attributes: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
            { tag: 'link', attributes: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap' } },
        ],
    };
}
```

The same `head()` is applied in both SSR and SSG (the `cossack ssg` CLI uses
your `App` automatically — see [Static Site Generation](./static-site-generation.md)).

## API Reference

### `HeadContext`

Contains the accumulated metadata from nested components:

- `title`: The current accumulated title string.
- `meta`: Array of accumulated meta tags.
- `links`: Array of accumulated link tags.
- `scripts`: Array of accumulated script tags.
- `tags`: Array of other accumulated tags (styles, base, etc.).

### `HeadValue`

The object you return from `head()`:

- `title`: (Optional) Set a new title.
- `meta`: (Optional) Override or add meta tags.
- `links`: (Optional) Override or add link tags.
- `scripts`: (Optional) Override or add script tags.
- `tags`: (Optional) Override or add other tags.

## Client-Side Synchronization

Cossack handles metadata updates automatically during **Soft Navigation**. When you navigate between pages or update a component's `@State`, the framework re-runs the entire merge stack and updates the DOM (including `document.title`) instantaneously.
