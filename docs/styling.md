---
title: "Styling"
description: "Use Tailwind CSS 4.x classes and custom CSS in Cossack applications."
---

# Styling

Cossack uses Tailwind CSS 4.x by default. The scaffolded project includes its configuration.

## How It Works

The `@tailwindcss/vite` plugin loads Tailwind from `vite.config.ts`. The CSS entry point is `src/style.css`:

```css
@import "tailwindcss";
```

This file is imported by `src/client/entry-client.ts`, so Tailwind utilities are available in every page and component.

## Using Tailwind Classes

Use Tailwind utility classes directly in your `html` tagged template literals via the `class` attribute:

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class MyPage extends Cossack {
    render() {
        return html`
            <div class="max-w-2xl mx-auto p-6">
                <h1 class="text-3xl font-bold text-gray-900 mb-4">Hello</h1>
                <p class="text-gray-600">Styled with Tailwind.</p>
            </div>
        `;
    }
}
```

### Conditional Classes

Use template literals to apply classes conditionally:

```typescript
render() {
    return html`
        <input
            class="w-full p-2 border rounded ${this.hasError('email') ? 'border-red-500' : 'border-gray-300'}"
            type="email"
            .value="${this.email}"
        />
        ${this.hasError('email')
            ? html`<span class="text-red-500 text-sm">${this.getError('email')}</span>`
            : ''}
    `;
}
```

### Dynamic Values

For dynamic values that static classes cannot express (for example, a progress bar width based on a percentage), keep an inline `style` attribute:

```typescript
render() {
    return html`
        <div class="w-full bg-gray-200 rounded-full h-2.5">
            <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${this.progress}%"></div>
        </div>
    `;
}
```

## Styling Components

Reusable components receive their styling through `class` props passed by the parent, or define their own base classes:

```typescript
// Button.ts
interface ButtonProps {
    variant?: 'primary' | 'secondary';
    [key: string]: any;
}

@Component()
export class Button extends Cossack {
    declare props: ButtonProps;

    render() {
        const { variant = 'primary', ...rest } = this.props;
        
        return html`
            <button class="bg-blue-500 hover:bg-blue-700 text-white py-2.5 px-5 cursor-pointer" ...=${rest}>
                ${this.children}
            </button>
        `;
    }
}

// Parent usage — override/add classes via class prop
<${Button} class="w-full">Submit</${Button}>
```

The spread (`...=${rest}`) passes through any extra attributes, including `class`, from the parent to the underlying element.

## Built-in Animations

Tailwind provides `animate-pulse` for common loading states. Use it for skeleton UIs:

```typescript
loadingTemplate() {
    return html`
        <h1>Loading...</h1>
        <div class="bg-gray-200 h-6 mb-3 rounded animate-pulse" style="width: 60%"></div>
        <div class="bg-gray-200 h-6 mb-3 rounded animate-pulse" style="width: 80%"></div>
    `;
}
```

## Custom CSS

If you need styles that Tailwind utilities cannot express (custom animations, complex selectors), use one of these two options:

### Scoped Component Styles

Declare `static styles` with the `css` tag. Cossack adds a `data-cossack-scope` attribute to the elements the component renders and rewrites every selector to match only them:

```typescript
import { Cossack, css, html } from '@cossackframework/core';

export class Card extends Cossack {
    static styles = css`
        .card { border: 1px solid #e5e7eb; border-radius: 0.75rem; }
        .card h3 { margin: 0; }
    `;

    render() {
        return html`<div class="card"><h3>${this.props.title}</h3></div>`;
    }
}
```

Each style scope gets one `<style data-cossack-style="…">` element in `<head>`, no matter how many instances render:

- SSR and static generation emit it in `<head>`, after the application CSS, in the order the page first uses each scope.
- In the browser, hydration adopts those elements. A scope's style is added when its first instance renders and removed after its last instance is gone. During a client navigation, styles that the next page also uses stay in place.
- Components rendered inside a shadow root get their own copy in that shadow root.

Scoped rules only match elements that carry their own scope, so the order of two components' styles only matters for global at-rules (`@font-face`, `@property`, `@counter-style`, `@layer` order). Those follow first-use order. Keep conflicting global at-rules in `src/style.css`.

> **Migration note.** Component output used to start with its own `<style>` element, which sat between sibling components. Structural selectors now match as written: `li + li`, `:first-child`, `:last-child`, `:nth-child()`, `:empty` and Tailwind `first:`, `odd:`, `even:`, `space-*` and `divide-*` see only the elements components render. Review selectors that worked around the old style elements.

### Per-Component `<style>` Blocks

You can also include a raw `<style>` tag inside a component's `render()` method. Cossack does not scope or deduplicate it: its rules apply to the whole document while the component is rendered, and every instance adds another copy. Prefer `static styles` for reusable components.

```typescript
render() {
    return html`
        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            .spinner { animation: spin 1s linear infinite; }
        </style>
        <div class="spinner w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
    `;
}
```

### Global CSS

Add global styles to `src/style.css` alongside the Tailwind import:

```css
@import "tailwindcss";

/* Custom global styles */
@keyframes spin {
    to { transform: rotate(360deg); }
}
```

## Dependencies

Tailwind CSS is included as a dev dependency in the framework package:

```json
{
    "devDependencies": {
        "@tailwindcss/vite": "^4.1.0",
        "tailwindcss": "^4.1.0"
    }
}
```

No PostCSS configuration or `tailwind.config.js` file is needed. Tailwind CSS 4.x detects utility classes automatically.
