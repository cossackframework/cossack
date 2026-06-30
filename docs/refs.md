---
title: "References (`@Ref`)"
description: "Direct DOM element references using the @Ref decorator for managing focus, text selection, and third-party library integration."
---

# References (`@Ref`)

Cossack provides a way to directly reference DOM elements within your components using the `@Ref` decorator, similar to React's `useRef` hook. This is useful for managing focus, text selection, or integrating with third-party DOM libraries.

## Basic Usage

To use a ref, decorate a property with `@Ref()` and type it as `RefObject<HTMLElement>`. Then, bind it to an element in your template using the `ref` attribute.

```typescript
import { Cossack, Page, Ref, html, type RefObject } from '@cossackframework/core';

@Page()
export default class RefExample extends Cossack {
    
    @Ref()
    declare inputRef: RefObject<HTMLInputElement>;

    @Client()
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

> **Note:** When using TypeScript with `useDefineForClassFields: true` (the default in Vite), you must use the `declare` keyword for properties decorated with `@Ref`. This prevents the compiler from emitting a property initializer that would overwrite the decorator's logic.

## How it Works

1.  **Declaration**: The `@Ref()` decorator initializes the property with a stable object `{ value: undefined }`.
2.  **Binding**: When the template is rendered, the `ref` attribute directive detects the `RefObject` and assigns the DOM element to its `.value` property.
3.  **Access**: You can access the underlying DOM element in `onMount()` or any subsequent method. Note that `this.inputRef.value` will be `undefined` during the initial server-side render.

## Functional Refs

You can also pass a function to the `ref` attribute if you need more control or don't want to use the decorator.

```typescript
render() {
    return html`
        <div ref=${(el: HTMLElement) => console.log('Element mounted:', el)}>
            Hello
        </div>
    `;
}
```
