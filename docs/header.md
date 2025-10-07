# Head Management

Cossack provides a simple yet powerful API for managing the document's `<head>` section directly from your components. This allows you to control tags like `<title>`, `<meta>`, `<script>`, and `<link>` dynamically.

## Basic Usage

To manage head tags, simply override the optional `header()` method in your page component. This method should return an array of `HeadTag` objects.

The framework will automatically render these tags on the server during the initial request and keep them updated on the client whenever your component's state changes.

### The `HeadTag` Interface

The `HeadTag` object has a simple and predictable structure:

```typescript
interface HeadTag {
  tag: 'title' | 'script' | 'style' | 'link' | 'meta' | 'base';
  attributes?: Record<string, string | boolean>;
  children?: string; // For inner content of tags like <title> or <style>
}
```

## Example

Here is an example of a component that sets a reactive `<title>` and a static `<meta>` description tag.

```typescript
import { Cossack, Page, Server, State, HeadTag } from '@cossackframework/core';
import { html, TemplateResult } from '@cossackframework/renderer';

@Page()
export class CounterPage extends Cossack {
    @State()
    private count: number = 0;

    @Server()
    private increment() {
        this.count++;
    }

    /**
     * This method is called on the initial server render and then
     * re-evaluated on the client every time the component's state changes.
     */
    public header(): HeadTag[] {
        return [
            // This title is reactive because it uses the `this.count` state property.
            { tag: 'title', children: `Count is: ${this.count}` },

            // This meta tag is static.
            { tag: 'meta', attributes: { name: 'description', content: 'A simple counter page.' } }
        ];
    }

    protected template(): TemplateResult {
        return html`
            <h1>The current count is ${this.count}</h1>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
```

### How Reactivity Works

Reactivity for the `header()` method works exactly like it does for the `template()` method.

-   If the `header()` method uses properties decorated with `@State`, the head tags will be automatically updated on the client whenever that state changes.
-   If the `header()` method only uses regular class properties or static values, the tags will be rendered once on the server and will remain static.

There is no need for a special decorator or flag to enable reactivity; it's built into the core state management system.
