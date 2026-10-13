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
- Directory-based: `src/pages/about/index.ts` → `/about`
- Flat file: `src/pages/about.ts` → `/about`

Both paths create the same route. Use a flat file for a simple page.

Example file structure:

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

### Typed URLs

Import `routes` from `virtual:cossack-routes` to construct URLs from discovered
page files. The route name uses brackets and omits route groups. A manifest is
the generated list of route paths and source identities.

For these files:

```text
src/pages/index.ts
src/pages/(account)/users/[id]/index.ts
src/pages/docs/[...path]/index.ts
src/pages/api/items/[id].ts
```

Use these calls:

```ts
import { routes } from 'virtual:cossack-routes';

routes('/');
routes('/users/[id]', { id: 'alice' });
routes('/docs/[...path]', { path: ['guide', 'first steps'] });
routes('/api/items/[id]', { id: '雪/a?b#c' });
// /api/items/%E9%9B%AA%2Fa%3Fb%23c
```

An ordinary parameter requires a string. A catch-all requires a nonempty array
of strings. Each string becomes one encoded path segment. Missing parameters,
extra parameters, incorrect types, and unknown names fail TypeScript checks.
Narrow a union of route names before passing its parameters.
For a manually authored registry, pass literal patterns directly or use `as const`.
Widened strings and runtime-selected pattern unions cannot establish parameter types.

The runtime also rejects empty strings, dot segments, invalid Unicode, sparse
catch-all arrays, and parameter getters. It reports `RouteUrlError` with a code,
route identity, and parameter name where available. The helper constructs path
URLs. Query state and navigation completion have separate contracts.

Vite generates `.cossack/routes.ts` at startup and build time. The development
watcher updates it after route-file additions and deletions. Keep that compiler
file out of Git. Error and 404 boundaries have no addressable route name.

New scaffolded applications map the virtual import in `tsconfig.json`. Their
`pnpm typecheck` script generates routes before TypeScript runs. For an existing
application, add this mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "virtual:cossack-routes": ["./.cossack/routes.ts"]
    }
  }
}
```

Preserve your other path mappings. Before a standalone TypeScript check, run:

```sh
pnpm exec cossack routes --generate
pnpm exec tsc --noEmit
```

CLI generation does not execute your Vite configuration. It includes Markdown
when the recorded scaffold recipe selects that feature. For a custom
`markdownProcessor`, add `--markdown` to the generation command. The processor
must also exist in your Vite configuration.

Only literal segments, `[name]`, and `[...name]` are supported for typed URLs.
Parameter names use ASCII letters, digits, underscores or hyphens, and start
with a letter or underscore.
Conflicting files with equal precedence stop generation. The direct file wins
over an equivalent file inside an additional route group, as in the router.

The generated browser module contains public patterns and the portable core
helper. For typed query values, defaults and history updates, read
[typed URL state](./url-state.md). Native API declarations use type-only page
references, which disappear from browser output. No page runtime imports,
schemas or handlers enter it. The structural manifest retains source layout
ancestry and nearest source boundaries.
Functional API handlers do not execute component layouts. Method and middleware
facts remain in `cossack routes --json` inspection. See
[declared API contracts and generated types](./api-routes.md#declared-input-and-output).

### Unknown URLs and boundary identity

For an unknown URL, Cossack selects the longest matching prefix from effective
source branches. Literal segments take precedence over parameters, followed by
catch-alls. Fewer route groups win an otherwise equal match. This preserves
directory names such as `(account)` and `[id]` that a public URL cannot identify.
An explicit 404 directory can own a namespace without an ordinary page.

For example, `/users/alice/missing` can select
`src/pages/(account)/users/[id]/404/index.ts`. The boundary and its layout
middleware receive `id: 'alice'`, including through `getRequestContext()`.
Encoded parameter values are decoded once. A malformed escape stays in its
owning scope for the guard to handle.

Equally ranked branches in separate groups use their common source ancestor.
For example, `(first)/area/one` and `(second)/area/two` do not choose either
private group for `/area/missing`. The common ancestor's nearest boundary
handles that URL, or the framework returns a plain 404.

Boundary layout and page middleware run before rendering. A guard can return
a response such as 403. A source middleware declaration already entered in the
request runs once, including when a page fails and selects an error boundary.
Global bootstrap middleware remains part of the same request. Error boundaries
use the failing page's source ancestry and preserve status 500.

Every 404 and error component has its own source ID. Boundaries have no public
route alias. Inspect a specific boundary with its source path:

```sh
pnpm exec cossack inspect routes '/src/pages/(account)/users/[id]/404/index.ts' --json
```

The browser hydrates the server-selected component and accepts validated
boundary documents during navigation. Responses retain their 404 or 500 status.
Boundary documents are not cached as successful pages. A plain error response
still produces a failed navigation.

### Route Groups

To group routes without changing their URLs, put the folder name in parentheses. Use route groups to share layouts.

Example:
* `src/pages/(auth)/login/index.ts` -> `/login`
* `src/pages/(auth)/register/index.ts` -> `/register`

### Nested Layouts

Cossack supports nested layouts via `layout.ts` files. A layout wraps all pages and sub-directories within its folder. Layouts nest automatically based on the file system hierarchy.

Example file structure:

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

Creating a layout:
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

Optimizations:
* Prefetching: Cossack fetches page data when a user points to a link.
* Caching: Cossack stores visited pages in memory for back and forward navigation.
* Persistent Layouts: If you navigate between pages that share a layout, for example `/login` to `/register`, the framework preserves the shared `AuthLayout` instance with its state and scroll position.
