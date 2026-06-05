---
name: create-layout
description: Create a Cossack layout component
disable-model-invocation: true
user-invocable: true
---

# Create a Cossack Layout

You are creating a layout for a Cossack Framework application. Layouts wrap page content and can be nested.

## Step 1: Determine the Layout Location

Ask the user:
1. Where should this layout live? Is it a root layout, a section layout, or a route group layout?

### Layout Placement Rules

Layouts are always named `layout.ts` and placed in the directory they should cover:

```
src/pages/
  layout.ts                ← Root layout (wraps ALL pages)
  about/
    layout.ts              ← Wraps all pages under /about/*
  contact/
    layout.ts              ← Wraps all pages under /contact/*
  (auth)/
    layout.ts              ← Wraps pages in the (auth) route group
    login/index.ts         ← URL: /login (wrapped by auth layout)
    register/index.ts      ← URL: /register (wrapped by auth layout)
  docs/
    layout.ts              ← Wraps all pages under /docs/*
```

## Step 2: Generate the Layout Class

Use this template:

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class SectionLayout extends Cossack {
  render() {
    return html`
      <div class="section-layout">
        <h2>Section Title</h2>
        ${this.children}
      </div>
    `;
  }
}
```

**Key points:**
- Layouts must be `export default`
- Use `${this.children}` to render the wrapped page content
- Layouts are decorated with `@Page()` (not a separate decorator)
- The `transport` option on layouts should generally be `http` since layouts don't have their own server actions

## Step 3: Understand Layout Nesting

Layouts stack automatically. For a page at `/docs/getting-started`:

```
src/pages/layout.ts           ← Outermost (root)
src/pages/docs/layout.ts      ← Middle (docs section)
src/pages/docs/getting-started/index.ts  ← Innermost (page)
```

The render order is:
1. Root layout wraps everything
2. Section layout wraps the page
3. Page content renders inside the section layout's `${this.children}`

### Nesting Example

Root layout (`src/pages/layout.ts`):
```typescript
@Page({ transport: 'http' })
export default class RootLayout extends Cossack {
  render() {
    return html`
      <div class="root-layout">
        <header>
          <nav><!-- Global nav --></nav>
        </header>
        <main>
          ${this.children}
        </main>
        <footer>Built with Cossack</footer>
      </div>
    `;
  }
}
```

Section layout (`src/pages/docs/layout.ts`):
```typescript
@Page({ transport: 'http' })
export default class DocsLayout extends Cossack {
  render() {
    return html`
      <div class="docs-layout">
        <aside><!-- Sidebar nav --></aside>
        <div class="docs-content">
          ${this.children}
        </div>
      </div>
    `;
  }
}
```

## Step 4: Layout Metadata (head)

Layouts can contribute to `<head>` via the `head()` method. Metadata merges from inside-out (page → child layout → root layout → App):

```typescript
@Page({ transport: 'http' })
export default class DocsLayout extends Cossack {
  public head(context: HeadContext): HeadValue {
    return {
      title: `Docs - ${context.title || 'Welcome'}`,
      meta: [
        { tag: 'meta', attributes: { name: 'description', content: 'Documentation section' } },
      ],
    };
  }

  render() {
    return html`
      <div>${this.children}</div>
    `;
  }
}
```

## Step 5: Layout Middleware

Layouts can define middleware that applies to all nested pages. Middleware runs in root-to-leaf order:

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

const sectionGuard = defineServerMiddleware(async (c, next) => {
  // Check access before any page in this section renders
  await next();
});

@Page({
  transport: 'http',
  middlewares: [sectionGuard],
})
export default class ProtectedLayout extends Cossack {
  render() {
    return html`<div>${this.children}</div>`;
  }
}
```

For a page inside a layout with middleware, the execution order is:
```
Root layout middleware → Section layout middleware → Page middleware → Page handler
```

## Step 6: Verify

1. File is named `layout.ts` in the correct directory
2. Class is `export default`
3. Uses `${this.children}` in the render output
4. Has `@Page()` decorator
5. Run type checks: `pnpm tsc --noEmit`
