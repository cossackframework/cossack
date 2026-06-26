---
title: "Routing in Cossack"
description: "File-based routing system that automatically creates routes based on the structure of the src/pages directory."
---

# Routing in Cossack

Cossack uses a simple and intuitive file-based routing system. You don't need to configure a central routing file; instead, the framework automatically creates routes based on the structure of your `src/pages` directory.

## How it Works

The framework scans for `.ts`, `.md`, and `.mdx` files within the `src/pages` directory and its subdirectories. The path to that file directly maps to a URL route.

### Basic Routing

A page can be defined in two ways:
- **Directory-based**: `src/pages/about/index.ts` → `/about`
- **Flat file**: `src/pages/about.ts` → `/about`

Both produce the same route. Flat files are more concise for simple pages.

**Example File Structure:**

```
src/
└── pages/
    ├── index.ts            // Serves the "/" route
    ├── hello.ts            // Serves the "/hello" route
    ├── hello.mdx           // Serves the "/hello" route (Markdown)
    ├── about/
    │   └── index.ts        // Also serves the "/about" route
    ├── docs/
    │   ├── index.md       // Serves the "/docs" route
    │   └── getting-started.mdx  // Serves the "/docs/getting-started" route
    └── contact/
        └── index.ts        // Serves the "/contact" route
```

### Dynamic Routes

To create a dynamic route that captures a segment of the URL, use square brackets `[]` in your directory name. The value of this segment will be available as a parameter in your page component.

For example, a page at `src/pages/users/[id]/index.ts` will match URLs like `/users/123` or `/users/alice`.

### Route Groups

You can organize your routes into logical groups without affecting the URL structure by wrapping the folder name in parenthesis. This is useful for sharing layouts (see below).

**Example:**
*   `src/pages/(auth)/login/index.ts` -> `/login`
*   `src/pages/(auth)/register/index.ts` -> `/register`

### Nested Layouts

Cossack supports nested layouts via `layout.ts` files. A layout wraps all pages and sub-directories within its folder. Layouts nest automatically based on the file system hierarchy.

**Example File Structure:**

```
src/
└── pages/
    ├── layout.ts            // Root Layout (wraps everything)
    ├── index/
    │   └── index.ts         // Home page (Root Layout -> Home)
    ├── (auth)/
    │   ├── layout.ts        // Auth Layout (wraps login/register)
    │   ├── login/
    │   │   └── index.ts     // /login (Root Layout -> Auth Layout -> Login)
    │   └── register/
    │       └── index.ts     // /register (Root Layout -> Auth Layout -> Register)
```

**Creating a Layout:**
A layout is a Cossack component that accepts children in its `render` method and can provide metadata via its `head` method.

```typescript
import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page()
export default class MyLayout extends Cossack {
  public head(context: HeadContext): HeadValue {
    return {
      // Branding that applies to all nested pages
      title: `My App | ${context.title}`
    };
  }

  render(children: TemplateResult) {
    return html`
      <div class="layout">
        <nav>...</nav>
        <main>${children}</main>
      </div>
    `;
  }
}
```

### Global App Component

For logic that must exist outside of the routing system (like global CSS, theme providers, or a top-level progress bar), Cossack uses `src/App.ts`. This component wraps the entire application and is never destroyed during client-side navigation.

### Client-Side Navigation

Cossack enables "soft navigation" by default. This means that when a user clicks a link (e.g., `<a href="/about">`), the framework intercepts the click, fetches the new page via AJAX, and swaps the content without a full browser refresh. This provides a fast, Single-Page Application (SPA) feel while maintaining the simplicity of server-side rendering.

**Optimizations:**
*   **Smart Pre-fetching**: Data is fetched when you hover over a link.
*   **Caching**: Visited pages are stored in memory for instant back/forward navigation.
*   **Persistent Layouts**: If you navigate between pages that share a layout (e.g., `/login` to `/register`), the shared `AuthLayout` instance is **preserved**, maintaining its state and scroll position.
