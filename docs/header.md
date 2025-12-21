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

Cossack's metadata system is designed for maximum Developer Experience (DX). If you don't return a specific category (like `links` or `meta`) in your `HeadValue` object, the framework automatically preserves the tags from the nested children.

#### Example: Root Branding in `App.ts`

```typescript
// src/App.ts
public head(context: HeadContext): HeadValue {
    return {
        // Wrap the child title with branding
        title: `Cossack Framework - ${context.title || 'Welcome'}`,
        // Set global viewport, while preserving all other meta/links from the page
        meta: [
            { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } }
        ]
    };
}
```

## API Reference

### `HeadContext`
Contains the accumulated metadata from nested components:
*   `title`: The current accumulated title string.
*   `meta`: Array of accumulated meta tags.
*   `links`: Array of accumulated link tags.
*   `scripts`: Array of accumulated script tags.
*   `tags`: Array of other accumulated tags (styles, base, etc.).

### `HeadValue`
The object you return from `head()`:
*   `title`: (Optional) Set a new title.
*   `meta`: (Optional) Override or add meta tags.
*   `links`: (Optional) Override or add link tags.
*   `scripts`: (Optional) Override or add script tags.
*   `tags`: (Optional) Override or add other tags.

## Client-Side Synchronization

Cossack handles metadata updates automatically during **Soft Navigation**. When you navigate between pages or update a component's `@State`, the framework re-runs the entire merge stack and updates the DOM (including `document.title`) instantaneously.