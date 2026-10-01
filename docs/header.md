---
title: 'Metadata Management (Head)'
description: 'Set document head tags in components and inherit them from layouts with the head method.'
---

# Metadata Management (Head)

Use the `head()` method in a component to set tags in the document's `<head>` section. Cossack merges these tags with values from parent layouts.

## Basic Usage

To set head tags, add the optional `head()` method to your component. It receives a `HeadContext` and returns a `HeadValue` object.

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

Cossack merges metadata from the page, then its layouts, then the global app.

- `title`, `description`, `image`: the child value wins unless a parent
 provides a value (`parentValue ?? childValue`).
- `meta`, `links`, `scripts`, `tags`: Cossack keeps the child's tags and adds
 the parent's tags. A root `App` can add global tags, such as font links,
 without removing page tags such as a canonical link.

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

The framework applies `head()` during SSR and SSG. The `cossack ssg` CLI uses
your `App` automatically. See [Static Site Generation](./static-site-generation.md).

## API Reference

### `HeadContext`

`HeadContext` contains the metadata that nested components have added:

- `title`: The current accumulated title string.
- `meta`: Array of accumulated meta tags.
- `links`: Array of accumulated link tags.
- `scripts`: Array of accumulated script tags.
- `tags`: Array of other accumulated tags (styles, base, etc.).

### `HeadValue`

Return a `HeadValue` object from `head()`:

- `title`: (Optional) Set a new title.
- `meta`: (Optional) Override or add meta tags.
- `links`: (Optional) Override or add link tags.
- `scripts`: (Optional) Override or add script tags.
- `tags`: (Optional) Override or add other tags.

## Client-Side Synchronization

Cossack updates metadata during soft navigation. When you move to another page or change a component's `@State`, the framework merges the metadata again and updates the DOM, including `document.title`.
