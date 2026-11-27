---
title: "Component Helpers"
description: "Built-in helpers and reactive properties for common tasks like navigation and state checks with the isActive method."
---

# Component Helpers

Cossack provides built-in helpers and reactive properties for common tasks, such as navigation and state checks.

## Navigation Helpers

### `this.c.req.path`

The current URL pathname is available on the server and the client through the context object. On the client, this property is reactive. Your component re-renders when the user navigates to a new page.

```typescript
render() {
  return html`
    <p>Current Path: ${this.c.req.path}</p>
  `;
}
```

### `this.isActive(path, exact = true)`

This method tests whether a path is the active path. It is mainly used for styling navigation links.

* `path`: the path to compare against.
* `exact`: with `true` (the default), the match is exact (`===`). With `false`, the method tests whether the current path starts with the given string.

#### Example: Styling Active Links

```typescript
render() {
  return html`
    <nav>
      <a href="/" class="${this.isActive('/') ? 'active' : ''}">Home</a>
      <a href="/docs" class="${this.isActive('/docs', false) ? 'active' : ''}">Docs</a>
    </nav>
  `;
}
```

## Internal Helpers

### `this.confirmNavigation(allow)`

Use this with the `@PreventNavigation` decorator to resolve a blocked navigation attempt.

* `this.confirmNavigation(true)`: proceed with the navigation.
* `this.confirmNavigation(false)`: stay on the current page and clear the pending navigation state.

See the [Prevent Navigation](./prevent-navigation.md) documentation for more details.


### `this.back(fallback = '/')`

Redirects the user to the previous page. On the server it follows the `Referer` header only when it has the same origin as the request; otherwise it redirects to the fallback (default `/`). On the client it calls `history.back()`, or navigates to the fallback when there is no history entry. Use it after a form submission or another action that returns the user to the previous page. On the server it returns the redirect `Response`, so `return` it.

```typescript
post() {
  // Handle form submission logic here

  return this.back(); // Redirect back to the previous page
}
```

### `this.redirect(url, status = 302)`

Redirects the user to a specified URL with an optional HTTP status code (default is 302 for temporary redirects). On the server it returns the redirect `Response`, so `return` it. On the client it navigates with the SPA router. The second argument can also be `{ status, types, scroll }`, where `types` and `scroll` are the client navigation's [view transition types](./view-transitions.md) and scroll behavior.

```typescript
post() {
  // Handle form submission logic here

  return this.redirect('/thank-you', 303); // Redirect to a thank you page
}

