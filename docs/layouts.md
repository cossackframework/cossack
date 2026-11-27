---
title: "Layouts"
description: "Layouts are components decorated with @Page and named layout.ts. They render the nested page content through this.children."
---

# Layouts

In Cossack, a layout is a component marked with `@Page` and named `layout.ts`. The framework sets `this.children` to the rendered nested page or layout before the layout renders.

```typescript
@Page({ transport: 'http' })
export default class MyLayout extends Cossack {
    render() {
        return html`
            <div class="wrapper">
                <header>My Header</header>
                <main>${this.children}</main>
            </div>
        `;
    }
}
```

Layouts can have state, transport, and middleware, like regular pages. A layout can also own services with `@Page({ services: [...] })`; see [Services](./services.md).

The server runs the layout's `init()` before the page's `init()`. During client navigation between pages under the same layout, the browser keeps the layout instance: its `@State` keeps the values from the first page, and only its `server$` resources, route params and user are refreshed. To show data about the current page in a layout, have the page publish it with `this.c.set()` and read it in a layout `server$` field, which runs at render time.

## Realtime layouts

A layout with `@Page({ transport: 'durable-object', scope })` is one live
instance per layout and scope key. Every page below it shares that instance,
and client navigation between those pages keeps the layout connected. A root
layout with a per-user scope gives app-wide per-user live state. The layout's
own guard stack authorizes its connection, with the route params of the page
the browser is on. See
[Share live state across page files](./websockets.md#share-live-state-across-page-files).
