# VSCode Snippets

Cossack ships with VSCode snippets to speed up common scaffolding tasks. They are scoped to TypeScript files and activate via prefix triggers.

Snippets are included automatically when you scaffold a new app with `create-cossack-app`. For existing projects, copy `.vscode/cossack.code-snippets` into your project's `.vscode/` directory.

## Scaffolding Snippets

These generate complete file structures.

| Prefix | Description |
|--------|-------------|
| `cpage` | New page with transport selector (`http`, `durable-object`, `websocket`) |
| `cpagelayout` | Page wrapped in a Layout component |
| `cpagedynamic` | Page with dynamic route params, `init()`, and `head()` |
| `clayout` | Layout file (`layout.ts`) with `this.children` slot |
| `ccomponent` | Reusable component with `@Prop`, attribute spread, and content projection |
| `cmiddleware` | Server middleware using `defineServerMiddleware()` |
| `cservice` | `@Service` class with `@State`, `@Server`, and `@Shared` methods |
| `cauthguard` | Auth guard middleware that redirects unauthenticated users to `/login` |

## Decorator & Member Snippets

These insert individual decorators or methods into an existing class.

| Prefix | Description |
|--------|-------------|
| `cstate` | `@State()` property (server-synced) |
| `cstatechannel` | `@State({ channel })` with a specific channel |
| `cclientstate` | `@ClientState()` property (client-only) |
| `cserver` | `@Server()` method |
| `cclient` | `@Client()` method |
| `cshared` | `@Shared()` method (runs on both client and server) |
| `ccomputed` | `@Computed()` getter |
| `coptimistic` | `@Optimistic()` handler |
| `cprop` | `@Prop()` component input |
| `cvalidate` | Validated `@State` property with rules |

## Lifecycle & Metadata Snippets

| Prefix | Description |
|--------|-------------|
| `chead` | `head()` method for page metadata (title, description) |
| `cinit` | `async init()` for server-side data loading |
| `conmount` | `onMount()` lifecycle hook (runs once after first client render) |
| `concleanup` | `onCleanup()` lifecycle hook (runs before component destruction) |

## Composition Snippet

| Prefix | Description |
|--------|-------------|
| `ccompose` | `component()` call to embed a child component with props and slot content |

## Usage

Type the prefix in a `.ts` file and press `Tab` or `Enter` to expand. Use `Tab` to jump between placeholders.

Example — type `cpage` and expand:

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })  // ← pick from dropdown
export default class PageName extends Cossack {
  // Optional: @State() properties, @Server() methods

  render() {
    return html`
      <div>
        <h1>Page Title</h1>
        <p>Page content</p>
      </div>
    `;
  }
}
```
