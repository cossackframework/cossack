---
title: "Layouts"
description: "Layouts are components decorated with @Page and named layout.ts. They receive a children argument with the nested page content."
---

# Layouts

In Cossack, a layout is a component marked with `@Page` and named `layout.ts`. Its `render` method receives a `children` argument with the rendered nested page or layout.

```typescript
@Page({ transport: 'http' })
export default class MyLayout extends Cossack {
    render(children: TemplateResult) {
        return html`
            <div class="wrapper">
                <header>My Header</header>
                <main>${children}</main>
            </div>
        `;
    }
}
```

Layouts can have state, transport, and middleware, like regular pages.
