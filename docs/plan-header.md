# Goal
Allow people to set the header-related tags, like <title>, <script>, <style>, <link>

## Proposed
Below is the minimal proposal of how do we set the header via Cossack.

```typescript
import { Page, Server, State } from '@cossackframework/core';

@Page()
export class Counter extends Cossack {
    // Defining header just by using the header() method.
    // The state is reactive too.
    // We don't need powerful system like lit-html (our renderer), 
    // however, if we can create a listener on state change and we loop through tags, 
    // replace the old header with new one is good though.
    // If this is too expensive (parsing html nodes, replacing), we can return an object instead, like:
    // [{tag: 'title', text: `Counter: ${this.count}`, {tag: 'script', attributes: {src: '//example.con/script.js'}, ...}]
    // It's up to you to choose the best.
    // Also, it's the best to let user choose the header needs to be reactive or not (default no reactive better).
    public header() {
        return reactive(`
            <title>Counter: ${this.count}</title>
            <script src="//example.com/script.js"></script>
            <link rel="stylesheet" href="//example.com/style.css">
            <style>body {background: red}</style>
        `)
    }

    // Or we can return an array of objects:
    public header() {
        return [
            { tag: 'title', text: `Counter: ${this.count}`, reactive: true }, // reactive or not
            { tag: 'script', attributes: {src: '//example.con/script.js' }, 
            { tag: 'link', href: '//example.com/style.css', rel: 'stylesheet' },
            { tag: 'style', text: 'body {background: red}' },
            ... // other tags
       ]
    }

    @State()
    private count: number = 0;

    @Server()
    private increment() {
        this.count++;
    }

    protected template() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
```
