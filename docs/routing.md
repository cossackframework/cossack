---
title: "Routing in Cossack"
description: "Create routes from the files and folders in src/pages."
---

# Routing in Cossack

Cossack creates routes from the files and folders in `src/pages`. You do not need a central routing file.

## How it Works

The framework scans `src/pages` and its subdirectories for `.ts`, `.md`, and `.mdx` files. Each file path maps to a URL route.

### Basic Routing

A page can be defined in two ways:
- **Directory-based**: `src/pages/about/index.ts` → `/about`
- **Flat file**: `src/pages/about.ts` → `/about`

Both paths create the same route. Use a flat file for a simple page.

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

To create a dynamic route, put a URL segment in square brackets `[]` in a directory name. The page component can read that segment as a parameter.

For example, a page at `src/pages/users/[id]/index.ts` will match URLs like `/users/123` or `/users/alice`.

### Route Groups

To group routes without changing their URLs, put the folder name in parentheses. Use route groups to share layouts.

**Example:**
* `src/pages/(auth)/login/index.ts` -> `/login`
* `src/pages/(auth)/register/index.ts` -> `/register`

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

Use `src/App.ts` for logic outside the routing system, such as global CSS, theme providers, or a top-level progress bar. This component wraps the application and remains mounted during client-side navigation.

### Client-Side Navigation

Cossack enables soft navigation by default. When a user clicks a link such as `<a href="/about">`, the framework fetches the page and replaces the content without a full browser refresh. The server still renders each page.

**Optimizations:**
* **Prefetching**: Cossack fetches page data when a user points to a link.
* **Caching**: Cossack stores visited pages in memory for back and forward navigation.
* **Persistent Layouts**: If you navigate between pages that share a layout (e.g., `/login` to `/register`), the shared `AuthLayout` instance is **preserved**, maintaining its state and scroll position.
