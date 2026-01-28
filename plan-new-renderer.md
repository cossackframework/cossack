# Plan - New Renderer (renderer2)

## Overview

Previously, we use the `packages/renderer` package, which is like `lit-html` clone with a few differences that made it fit with Cossack needs. However, it:
- Does not support composition well (no support for nested templates)
- Does not have class based components.

That said, it's hard to build complex UIs with the old renderer, we have to create functions that return strings of HTML, which is not very maintainable.

To solve these issues, I have created a new package `packages/renderer2` that is based on `lit` and `lit-html`. This new renderer supports nested templates and class based components, making it more flexible and powerful. See the [renderer2 docs](@/packages/renderer2/docs/usage.md) for more details.

However, the new `renderer2` is still a standalone package and is not yet integrated into Cossack monorepo, and Cossack framework. I have just copied the renderer2 package into the `packages` folder so you can see the structure and code.

## Goals

- Integrate `renderer2` into Cossack monorepo.
- Replace the old `renderer` package with `renderer2` in Cossack framework (then rename `renderer2` to `renderer`).
- Rewrite existing components, pages, docs to use the new renderer.

## Things to consider

### Architecture

This is a big refactor that touches many parts of the codebase. Read the @docs/architecture.md to understand how Cossack is structured and how the renderer fits into it. Also, read other docs in the `docs` folder to understand how Cossack works, like `states.md`, `tasks.md`, `ref.md`, `environment.md` etc.

### State management

Previously, the renderer has no built-in state management. The state management is handled by Cossack framework itself. With the new renderer, the `CossackElement` class has built-in state management using reactive properties. We need to ensure that the state management in Cossack framework works well with the new renderer.

### Render

Previously, the Cossack framework handles rendering by using the `render`, `renderToString` (SSR) functions and `html` tag from the old renderer. Quite like plain `lit-html` library. Now we need to rewrite the framework to somehow extend the `CossackElement` class from the new renderer and use its `render` method to define the component's template, but still make sure our existing APIs work as expected.

### Questions

Let me know if you have any questions or concerns about this plan. We can discuss and refine it further before starting the implementation.

