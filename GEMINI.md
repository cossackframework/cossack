# Gemini Project Plan: TIL (A `lit-html` inspired library)

This document outlines the development plan for the `til` rendering library.

## Current State: Alpha

The library is currently in an alpha state. The core APIs for client-side and server-side rendering are functional, but breaking changes are possible and advanced features are not yet implemented.

## v1.0 Release Plan

The goal for the v1.0 release is to provide a stable, performant, and reliable library for building applications with server-side rendering and client-side interactivity.

### Key Features & Goals

-   [x] **Core Templating:** `html` tag for creating templates.
-   [x] **Client-Side Rendering:** Efficient DOM updates.
-   [x] **Server-Side Rendering (SSR):** Generate HTML on the server.
-   [ ] **Hydration:** Efficiently attach client-side interactivity to server-rendered HTML.
-   [ ] **Stability:** Stable API with no breaking changes planned post-v1.0.
-   [ ] **Documentation:** Comprehensive documentation for all public APIs.

### Hydration Plan

**Description:** Implement a hydration mechanism to improve initial page load performance. Instead of re-rendering the component on the client, hydration will "adopt" the existing server-rendered DOM, attaching event listeners and creating dynamic parts without replacing the HTML. This will be achieved by embedding lightweight comment markers (e.g., `<!--til-part-->`) in the server-rendered HTML, which the client can use to quickly identify and wire up dynamic bindings. This avoids a full re-render, resulting in a faster and smoother user experience.

## Component API

### Spreading Attributes

The `til` library supports a special `...` attribute syntax for spreading an object of properties onto an element. This is useful for creating reusable components that can accept arbitrary HTML attributes.

**Example:**

```typescript
import { html, type TemplateResult } from "@cossackframework/renderer";

type ButtonProps = {
    variant?: 'primary' | 'secondary';
    [key: string]: any;
};

export const Button = (props: ButtonProps, children: TemplateResult) => {
    const { variant = 'primary', ...rest } = props;
    
    return html`
        <button data-variant="${variant}" ...=${rest}>
            ${children}
        </button>
    `;
};
```

In this example, any additional properties passed in the `props` object (e.g., `class`, `id`, `@click`) will be spread onto the `<button>` element.
