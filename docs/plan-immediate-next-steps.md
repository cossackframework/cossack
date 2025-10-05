# Immediate Next Steps for Production Readiness

This document outlines the most critical features required to make the Cossack Framework production-ready. These items address the core needs of reliability, security, and real-world application functionality.

## 1. Database Persistence with Cloudflare D1

**This is the highest priority.** The framework's state is currently ephemeral and will be lost if a Durable Object hibernates or is restarted.

### Why It's Critical

-   **Data Integrity:** Without persistence, no data is safe. A simple server restart would wipe all application state.
-   **Real-World Viability:** No production application can be built on an in-memory-only state model.

### Implementation Plan

1.  **Create a D1 Database:** Add a D1 database binding to `packages/framework/wrangler.jsonc`.
2.  **Generate Types:** Run `pnpm --filter @cossackframework/framework run cf-typegen` to make the `DB` binding available in Hono's `c.env`.
3.  **Modify `CossackDurableObject`:**
    -   In the `bootstrap` or `init` method of the component instance within the DO, fetch the component's initial state from the D1 database.
    -   After every server-side action that modifies state (e.g., `deleteTask`), write the updated state back to the database.

## 2. Authentication & Authorization

Production applications require a robust way to manage users and control access. The current hardcoded user is a placeholder.

### Why It's Critical

-   **Security:** Protects user data and application resources.
-   **Functionality:** Enables personalized experiences and user-specific data.

### Implementation Plan

1.  **Flesh out `@cossackframework/auth`:** This package should contain the core authentication logic.
2.  **Database Schema:** Define `users` and `sessions` tables in the D1 database.
3.  **Create `auth` Middleware:** In the `framework` package, create a middleware that inspects incoming requests for a session token, validates it against the database, and attaches a real `user` object to the Hono context (`c.set('user', ...)`) or rejects the request.
4.  **Implement Core Auth Methods:** Create methods like `Auth.login(email, password)`, `Auth.logout()`, and `Auth.user()` that can be called from within component actions.

## 3. Robust Error Handling & Resilience

The framework currently has a "happy path" implementation. It needs to be resilient to common failures like network interruptions or server-side errors.

### Why It's Critical

-   **User Experience:** A fragile UI that hangs or breaks on simple errors is not acceptable in production.
-   **Stability:** The server should handle unexpected errors gracefully without crashing or leaving clients in a broken state.

### Implementation Plan

1.  **Client-Side (WebSocket Resilience):**
    -   In the `Cossack` base class (`packages/core/src/shared/cossack.ts`), add logic to the `onclose` event of the WebSocket to automatically attempt reconnection with an exponential backoff strategy.
2.  **Server-Side (Action Error Handling):**
    -   In the `CossackDurableObject`'s `webSocketMessage` handler, wrap the call to the component's action (e.g., `this.componentInstance[action](...)`) in a `try...catch` block.
    -   If an error is caught, send a specific error message back to the client over the WebSocket.
    -   The client-side `proxyServerMethods` logic should be updated to handle this error message, for example, by showing an alert and resetting the `loading` state for the failed action.
