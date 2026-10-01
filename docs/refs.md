---
title: "References (`@Ref`)"
description: "Direct DOM element references using the @Ref decorator for managing focus, text selection, and third-party library integration."
---

# References (`@Ref`)

Use the `@Ref` decorator to reference a DOM element from a component. A DOM element is an item in the browser's document tree. Refs help you manage focus and text selection or connect a DOM library.

## Basic Usage

To use a ref, declare a property with the `@Ref()` decorator and type it as `RefObject<HTMLElement>`. Then set the `ref` attribute on an element in your template.

```typescript
import { Cossack, Page, Ref, html, type RefObject } from '@cossackframework/core';

@Page()
export default class RefExample extends Cossack {
    
    @Ref()
    declare inputRef: RefObject<HTMLInputElement>;

    onMount() {
        // Access the DOM element via .value
        this.inputRef.value?.focus();
    }

    render() {
        return html`
            <h1>Focus Me</h1>
            <input type="text" ref=${this.inputRef} placeholder="I will be focused automatically" />
        `;
    }
}
```

## How it Works

1. **Declaration**: The `@Ref()` decorator initializes the property with an object: `{ value: undefined }`.
2. **Binding**: When Cossack renders the template, the `ref` attribute assigns the DOM element to `.value`.
3. **Access**: Read the DOM element in `onMount()` or a later method. `this.inputRef.value` is `undefined` during server-side rendering.

## Functional Refs

You can also pass a function to the `ref` attribute instead of using the decorator.

```typescript
render() {
    return html`
        <div ref=${(el: HTMLElement) => console.log('Element mounted:', el)}>
            Hello
        </div>
    `;
}
```
