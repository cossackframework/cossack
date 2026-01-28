# Cossack Framework DX Improvements Plan

This document outlines the roadmap for the next phase of developer experience (DX) improvements, focusing on component autonomy, composability, and testing.

---

## ✅ Completed Improvements

### 1. Stateful Nested Components (Server Actions) ✅

**Goal:** Enable reusable components to maintain their own state on the server and handle `@Server` actions directly, removing the need to lift all state to the Page level.

**Status:** ✅ **COMPLETED**

**Implementation:**
-   **Component IDs:** Implemented stable, deterministic IDs (`root:0`, `root:1`, etc.)
-   **State Persistence:** Child component state is tracked and persisted alongside Page state in `_children`
-   **Action Routing:** `/crpc` and `/upload` endpoints route actions to the correct component via `target` parameter
-   **State Restoration:** Components restore their state from the request payload before executing actions

**Documentation:** See [Components - Server Actions](./docs/components.md#server-actions-in-components) and [States - Nested Component State Flow](./docs/states.md#nested-component-state-flow)

---

### 2. Framework Context API ✅

**Goal:** Provide standard access to global framework context (`Env`, `User`, `Request`) in any component without prop drilling.

**Status:** ✅ **COMPLETED**

**Implementation:**
-   **Context Definitions:** Defined `EnvContext`, `UserContext`, `RequestContext` in `packages/core/src/shared/context.ts`
-   **Provider:** Root `App` component provides these contexts during bootstrap
-   **Consumer:** Components access via `this.env`, `this.user`, `this.c` properties

**Documentation:** See [Framework Context API](./docs/framework-context.md)

---

### 3. Testing Utility Library ✅

**Goal:** Simplify unit and integration testing for users by providing a dedicated testing library, abstracting away the complex mocking required for the renderer.

**Status:** ✅ **COMPLETED**

**Implementation:**
-   **Package:** Created `@cossackframework/test-utils` at `packages/test-utils/`
-   **Render Helper:** `render(Component, options)` that returns a helper object
-   **Interaction Helpers:** `click(selector)`, `type(selector, text)`, `waitForUpdate()`
-   **Cleanup:** `unmount()` method for proper teardown

**Documentation:** See [Components - Testing](./docs/components.md#testing)

---

## Future Improvements

### 4. Component Lifecycle Hooks

**Goal:** Provide more granular lifecycle hooks for better control over component behavior.

**Proposed Hooks:**
-   `onMount()`: Called after component is added to DOM
-   `onUpdate(changedProps)`: Called after component updates
-   `onUnmount()`: Called before component is removed
-   `onError(error)`: Called when an error occurs

---

### 5. Suspense and Loading States

**Goal:** Built-in support for async operations with automatic loading states.

```typescript
@Component()
export class UserProfile extends Cossack {
    @State()
    user: any = null;

    @Suspense()
    async loadUser() {
        this.user = await this.env.DB.get(this.user.id);
    }

    render() {
        if (this.$suspense.pending) {
            return html`<loading-spinner />`;
        }
        return html`<user-profile .user="${this.user}" />`;
    }
}
```

---

### 6. Form Validation

**Goal:** Integrated form validation with decorators.

```typescript
@Component()
export class LoginForm extends Cossack {
    @Prop() onSubmit!: (data: { email: string; password: string }) => void;

    @State()
    @Validate({ email: true, required: true })
    email = '';

    @State()
    @Validate({ minLength: 8, required: true })
    password = '';

    @State()
    errors: Record<string, string> = {};

    render() {
        return html`
            <form @submit="${this.handleSubmit}">
                <input type="email" @input="${e => this.email = e.target.value}" />
                ${this.errors.email ? html`<error>${this.errors.email}</error>` : ''}

                <input type="password" @input="${e => this.password = e.target.value}" />
                ${this.errors.password ? html`<error>${this.errors.password}</error>` : ''}
            </form>
        `;
    }
}
```

---

### 7. Server Component Mode

**Goal:** Components that render exclusively on the server (no client JS).

```typescript
@ServerComponent()
export class SecretData extends Cossack {
    async init() {
        this.data = await this.env.DB.getSecretData();
    }

    render() {
        return html`<div>${this.data}</div>`;
    }
}
```

---

### 8. Real-time Subscriptions

**Goal:** Subscribe to database changes or external events.

```typescript
@Component()
export class LiveCounter extends Cossack {
    @State()
    count = 0;

    @Subscribe('kv:counter')
    onCountUpdate(value: number) {
        this.count = value;
    }

    render() {
        return html`Count: ${this.count}`;
    }
}
```
