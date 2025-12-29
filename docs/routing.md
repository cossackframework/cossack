# File-Based Routing in Cossack

Cossack uses a simple and intuitive file-based routing system. You don't need to configure a central routing file; instead, the framework automatically creates routes based on the structure of your `src/pages` directory.

## How it Works

The framework scans for any file named `index.ts` or `index.mdx` within the `src/pages` directory and its subdirectories. The path to that file directly maps to a URL route.

### Basic Routing

A page component at `src/pages/about/index.ts` will be served at the `/about` URL. A component at `src/pages/index/index.ts` (or `src/pages/index.ts`) will be the root page, served at `/`.

**Example File Structure:**

```
src/
└── pages/
    ├── index/
    │   └── index.ts     // Serves the "/" route
    ├── about/
    │   └── index.ts     // Serves the "/about" route
    ├── docs/
    │   └── index.mdx    // Serves the "/docs" route (Markdown support!)
    └── contact/
        └── index.ts     // Serves the "/contact" route
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
A layout is a Cossack component that accepts children in its `template` method and can provide metadata via its `head` method.

```typescript
import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
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

---

## Advanced: The Magic Behind the Scenes

For those curious about the underlying mechanics, the "magic" of file-based routing is handled by a custom Vite plugin at build time. This approach ensures zero-runtime overhead and keeps the user's application code clean and free of boilerplate.

### 1. The `cossackPages` Vite Plugin

The core of the system is a Vite plugin named `cossackPages`, which is automatically included when you use the Cossack framework. During the build process, this plugin scans your project for `index.ts` (pages) and `layout.ts` (layouts).

### 2. The `virtual:cossack-pages` Module

Once the plugin has found all the files, it creates a **virtual module** named `virtual:cossack-pages` containing a map of all pages and layouts.

### 3. The Router

The framework's `createApp()` function consumes this map. It constructs the route tree, identifying the stack of layouts for each page. It registers Hono routes that automatically:
1.  Bootstrap the Global App.
2.  Bootstrap the entire stack of Layouts (Root -> ... -> Parent).
3.  Bootstrap the Page.
4.  Render them nested inside each other.