---
title: 'Metadata Management (Head)'
description: 'Set document head tags in components and inherit them from layouts with the head method.'
---

# Metadata Management (Head)

Use the `head()` method in a component to set tags in the document's `<head>` section. Cossack merges these tags with values from parent layouts.

## Basic Usage

To set head tags, add the optional `head()` method to your component. It receives a `HeadContext` and returns a `HeadValue` object.

The framework merges metadata from the inside out:
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

`HeadContext` contains the metadata that nested components added:

- `title`: The current accumulated title string.
- `description`: The accumulated `<meta name="description">` content.
- `image`: The accumulated `og:image` content.
- `meta`: Array of accumulated meta tags.
- `links`: Array of accumulated link tags.
- `scripts`: Array of accumulated script tags.
- `tags`: Array of other accumulated tags, for example styles and base.

### `HeadValue`

Return a `HeadValue` object from `head()`:

- `title`: Optional. Sets a new title.
- `description`: Optional. Adds `<meta name="description">` and `og:description` tags.
- `image`: Optional. Adds `og:image` and `twitter:image` tags.
- `meta`: Optional. Adds meta tags after the nested components' tags.
- `links`: Optional. Adds link tags after the nested components' tags.
- `scripts`: Optional. Adds script tags after the nested components' tags.
- `tags`: Optional. Adds other tags, such as `<style>` and `<base>`.

Each tag is a `HeadTag`: `{ tag, attributes?, children? }`. In development, a tag in the wrong array (for example a `link` in `meta`) logs a warning.

## Client-Side Synchronization

Cossack updates metadata during soft navigation. When you move to another page or change a component's `@State`, the framework merges the metadata again and updates the DOM, including `document.title`.
