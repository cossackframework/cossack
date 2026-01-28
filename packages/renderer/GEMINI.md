# Cossack Renderer
The official Cossack Framework rendering engine, designed for **Light DOM** and **Server Side Rendering (SSR)**.

## System
You are the lead developer of the `@cossackframework/renderer` library.

## Rules
- Must be fully compatible with Lit declarative templates.
- Must use light dom instead of shadow dom.
- Must support server side rendering (SSR).
- Use pnpm as package manager.

## Overview
This library replaces the legacy `lit-html` clone. It provides a robust, class-based component model with reactive properties, while maintaining a lightweight footprint suitable for edge computing.

## Goals
- Full compatibility with Lit declarative templates (`html`, `svg`).
- Use **Light DOM** only (no Shadow DOM) for easy CSS integration.
- **Server Side Rendering (SSR)** by returning HTML strings directly, with zero DOM shim requirements.
- **React/Vue-like Component Model**: Components are logical units that manage their own state and lifecycle, rendering to a container or part.
- **Security**: HTML escaping by default, with `unsafeHTML` directive for raw content.
- **Composability**: Support for nested components and `children` projection.
- **Context API**: Share state deeply through the component tree without prop drilling.
- **JSX-like Syntax**: Support `<c:Component>` syntax in templates.
- **Lit Syntax**: Support `@event`, `.property`, and `?boolean` binding.
- **Reactive Controllers**: Support for reusable stateful logic via controllers.

## Architecture
- **Engine**: Custom `lit-html` implementation using `TemplateResult`.
- **Parts**: 
    - `NodePart`: Handles dynamic content (text, templates, arrays).
    - `AttributePart`: Handles attribute binding, properties (`.`), booleans (`?`), and events (`@`).
    - `SpreadPart`: Handles spread syntax `...=${vars}`.
    - `ComponentPropPart`: Handles property binding for `<c:Component>`.
- **SSR**: `renderToString` performs a single-pass string generation with **Tag Scanning** for `<c:Component>` and spread syntax support.
- **Hydration**: Client-side `render` replaces content or updates existing parts (smart diffing).
- **Components**: `LitElement` (aliased as `CossackElement` in core) is a standalone class that implements the standard reactive update cycle (`properties`, `shouldUpdate`, `willUpdate`, `render`, `updated`), `children` projection, Context (`provide`, `consume`), and Reactive Controllers.
    - `static components`: Registry for local component resolution.

## Status
- [x] Implement `render`, `renderToString` (SSR), `html`, `svg` functions.
- [x] Implement `unsafeHTML` for raw content injection.
- [x] Write tests for rendering, SSR, security, and component lifecycle.
- [x] Implement `LitElement` compatible base class with reactive properties.
- [x] Make `LitElement` composable via `component(Class, props, children)` helper.
- [x] Implement SSR support for `LitElement` compatible base class.
- [x] Hydration support for `LitElement` compatible base class (Server Render -> Client Replace).
- [x] Implement `children` projection support.
- [x] Implement **Context API** (`createContext`, `provide`, `consume`).
- [x] Implement standard directives: `ref`, `live`, `repeat`, `classMap`, `styleMap`.
- [x] Implement **`<c:Component>`** syntax support.
- [x] Implement spread syntax `...=${vars}`.
- [x] Implement Lit-style bindings (`@`, `.`, `?`).
- [x] Implement Reactive Controllers support.
