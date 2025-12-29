# Component Helpers

Cossack provides several built-in helpers and reactive properties to make common tasks, like navigation and state checking, easier to implement.

## Navigation Helpers

### `this.c.req.path`

The current URL pathname is available on both the server and the client via the context object. On the client, this property is **reactive**, meaning your component will automatically re-render when the user navigates to a new page.

```typescript
render() {
  return html`
    <p>Current Path: ${this.c.req.path}</p>
  `;
}
```

### `this.isActive(path, exact = true)`

A convenience method to check if a specific path is currently active. This is primarily used for styling navigation links.

*   **`path`**: The path to check against.
*   **`exact`**: If `true` (default), it performs an exact match (`===`). If `false`, it checks if the current path starts with the given string.

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

Used in conjunction with the `@PreventNavigation` decorator to resolve a blocked navigation attempt.

*   `this.confirmNavigation(true)`: Proceed with the navigation.
*   `this.confirmNavigation(false)`: Stay on the current page and clear the pending navigation state.

See the [Prevent Navigation](./prevent-navigation.md) documentation for more details.
