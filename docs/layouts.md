# Layouts

Layouts in Cossack are simply components decorated with `@Page` that are named `layout.ts` in the file system. The key difference is that a layout's `template` method receives a `children` argument, which contains the rendered content of the nested page (or nested layout).

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

Layouts can have their own state, transport, and middleware, just like regular pages.
