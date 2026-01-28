# Cossack Framework DX Improvements Plan

This document outlines the roadmap for the next phase of developer experience (DX) improvements, focusing on component autonomy, composability, and testing.

## 1. Stateful Nested Components (Server Actions)

**Goal:** Enable reusable components to maintain their own state on the server and handle `@Server` actions directly, removing the need to lift all state to the Page level.

**Current Limitation:** Only `Page` and `Layout` components persist in the Durable Object. Nested components are transient during render. Actions dispatched from them must be handled by the Page.

**Implementation Strategy:**
-   **Component IDs:** Implement a mechanism to generate stable, deterministic IDs for component instances during render (e.g., based on position/path in the tree).
-   **State Persistence:** Update the `Cossack` base class (server-side) to track child component instances and persist their state alongside the Page state.
-   **Action Routing:** Update the Router/Durable Object to handle "namespaced" actions (e.g., `target: "cmp_123", action: "increment"`) and route them to the correct child instance.
-   **Garbage Collection:** Ensure child components are cleaned up from state when they are no longer rendered.

## 2. Named Slots for Composition

**Goal:** Allow components to define multiple content insertion points (slots), enabling complex layouts like Cards, Modals, or Dashboards.

**Current Limitation:** Components only support a single `this.children` injection point.

**Implementation Strategy:**
-   **Syntax:** Support `<div slot="header">` attribute in the template parser.
-   **Renderer:** Update `cossack-html` to extract elements with `slot` attributes during parsing.
-   **Component API:** Expose a `this.slots` map (e.g., `this.slots.header`) on `CossackElement`.
-   **SSR & Client:** Ensure slots are correctly serialized and hydrated.

## 3. Framework Context API

**Goal:** Provide standard access to global framework context (`Env`, `User`, `Request`) in any component without prop drilling.

**Current Limitation:** `env` and `user` are manually injected into Pages. Deeply nested components require these to be passed down as props to access DB or User ID.

**Implementation Strategy:**
-   **Context Definitions:** Define `EnvContext`, `UserContext`, `RequestContext` using `createContext`.
-   **Provider:** Update the root `App` or `Page` bootstrap process to `provide` these contexts.
-   **Consumer:** Allow any component to `consume` these contexts to access `this.env.DB` or `this.user.id` directly.

## 4. Testing Utility Library

**Goal:** Simplify unit and integration testing for users by providing a dedicated testing library, abstracting away the complex mocking required for the renderer.

**Implementation Strategy:**
-   **Package:** Create `@cossackframework/test-utils`.
-   **Render Helper:** `render(Component, props)` that returns a wrapper.
-   **Interaction Helpers:** `wrapper.click()`, `wrapper.find()`, `wrapper.text()`.
-   **Mocking:** Auto-mock `fetch` and WebSocket communication for isolated component testing.
