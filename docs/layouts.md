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

## Realtime layouts

A layout with `@Page({ transport: 'durable-object', scope })` is one live
instance per layout and scope key. Every page below it shares that instance,
and client navigation between those pages keeps the layout connected. A root
layout with a per-user scope gives app-wide per-user live state. The layout's
own guard stack authorizes its connection, with the route params of the page
the browser is on. See
[Share live state across page files](./websockets.md#share-live-state-across-page-files).
