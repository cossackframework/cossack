---
title: "Styling"
description: "Styling in Cossack is powered by Tailwind CSS 4.x, providing a utility-first approach to design. This guide covers how to use Tailwind classes, conditional styling, dynamic values, component styling, built-in animations, and custom CSS options."
---

# Styling

Cossack ships with Tailwind CSS 4.x as the default styling solution. It is pre-configured and ready to use — no additional setup required.

## How It Works

Tailwind is integrated via the `@tailwindcss/vite` plugin in `vite.config.ts`. The CSS entry point is `src/style.css`:

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

For truly dynamic values that cannot be expressed as static classes (e.g., a progress bar width based on a percentage), keep an inline `style` attribute:

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
${component(Button, { class: 'w-full' }, 'Submit')}
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

If you need styles that Tailwind utilities cannot express (custom animations, complex selectors), you have two options:

### Per-Component `<style>` Blocks

You can include a `<style>` tag inside a component's `render()` method. These styles are scoped to the component's rendered output:

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
...

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

No PostCSS config or `tailwind.config.js` file is needed — Tailwind CSS 4.x detects utility classes automatically.
