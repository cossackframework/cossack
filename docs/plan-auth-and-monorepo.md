# Cossack Framework: Monorepo and Authentication Architecture Plan

This document outlines the agreed-upon plan for restructuring the Cossack Framework into a monorepo, introducing a dedicated authentication package, and creating a starter template CLI.

## 1. Monorepo Structure

We will restructure the project into a pnpm monorepo to better manage the different parts of the framework.

### Directory Structure:

```
/
├── packages/
│   ├── core/                 # @cossackframework/core
│   ├── auth/                 # @cossackframework/auth
│   ├── renderer/             # @cossackframework/renderer (Placeholder for now)
│   ├── framework/            # @cossackframework/framework (The public meta-package)
│   └── create-cossack-app/   # create-cossack-app (The starter CLI)
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.json
```

### Package Responsibilities:

*   **`@cossackframework/core`**: The existing codebase. It will manage file-based routing for components, Durable Object logic, state management, and WebSocket communication. It will be made auth-agnostic.
*   **`@cossackframework/auth`**: A new package responsible for providing authentication tools. It will be flexible and unopinionated about the developer's database or user schema.
*   **`@cossackframework/renderer`**: The client-side rendering engine.
*   **`@cossackframework/framework`**: The public-facing "meta-package" that developers will install. It will bundle and re-export the necessary APIs from `core`, `auth`, and `renderer`.
*   **`create-cossack-app`**: A CLI tool that generates a new Cossack project boilerplate, enabling users to get started quickly with `pnpm create cossack-app`.

## 2. The `create-cossack-app` Starter CLI

To provide a smooth onboarding experience, we will create a command-line tool that scaffolds a new project.

*   **Command:** `pnpm create cossack-app <project-name>`
*   **Functionality:** The tool will copy a default project template into a new directory.
*   **Template Contents:** The starter template will include a minimal, working Cossack application with:
    *   A `package.json` with `@cossackframework/framework` as a dependency.
    *   Pre-configured `wrangler.jsonc` and `tsconfig.json` files.
    *   A `src` directory with a "Hello World" page, a basic layout, and the main Hono entrypoint (`index.ts`).

## 3. Authentication Architecture (`@cossackframework/auth`)

The auth package will be designed to be minimal, secure, and highly flexible, allowing developers to implement their own logic (e.g., cookie sessions, JWTs, etc.). Our primary examples will use secure, HTTP-only cookie-based sessions.

### Core API: `createCossackAuth`

The package will export a single factory function, `createCossackAuth`, which the developer uses to provide their specific authentication strategy.

**Developer Provides (`AuthOptions`):**
*   `strategy`: An object containing the developer's own logic for handling sessions.
    *   `extractSessionId`: A function `(c: Context) => string | undefined` that gets a session identifier from the incoming request (e.g., by reading a cookie).
    *   `validateSessionId`: An async function `(sessionId: string, c: Context) => Promise<string | null>` that verifies the session ID (e.g., by checking it against a database) and returns the corresponding **user ID**.
*   `resolveUserById`: An async function `(userId: string, c: Context) => Promise<User | null>` that fetches the full user object from the database using the ID returned by `validateSessionId`.

**Package Returns (`AuthKit`):**
*   `middleware`: A Hono middleware that protects routes. It uses the developer's provided `strategy` functions to extract and validate the session, then uses `resolveUserById` to attach the full user object to the Hono context (`c.set('user', user)`).
*   `createLoginHandler`: A utility to help the developer build their own login endpoint. The developer provides:
    *   `validateCredentials`: A function to verify user credentials (e.g., email/password).
    *   `createSession`: A function that runs after successful login to create a session in the database and returns a `Headers` object, typically with a `Set-Cookie` directive.

### Example Implementation (Developer's Application Code)

This demonstrates a secure, cookie-based session implementation.

**File: `src/auth.ts` (Developer's Code)**
```typescript
import { createCossackAuth } from '@cossackframework/framework';
import { getCookie, setCookie } from 'hono/cookie';
import type { User } from './db'; // Developer's own User type
import { db } from './db'; // Developer's DB client

export const { middleware, createLoginHandler } = createCossackAuth<User>({
    strategy: {
        extractSessionId: (c) => {
            return getCookie(c, 'auth_session_id');
        },
        validateSessionId: async (sessionId, c) => {
            const session = await db.findSessionById(sessionId);
            if (!session || session.expiresAt < new Date()) {
                return null; // Session is invalid or expired
            }
            return session.userId; // Return the user ID
        }
    },
    resolveUserById: async (userId, c) => {
        return await db.findUserById(userId);
    }
});

// The developer also creates their own login handler using our utility
export const loginHandler = createLoginHandler({
    validateCredentials: async (credentials, c) => {
        // Developer's logic to check email/password against the DB
        return await db.verifyUserPassword(credentials.email, credentials.password);
    },
    createSession: async (user, c) => {
        // Developer's logic to create a session in the DB
        const session = await db.createSessionForUser(user.id);
        
        // Create the cookie and return it in the headers
        const headers = new Headers();
        setCookie(headers, 'auth_session_id', session.id, {
            httpOnly: true,
            secure: c.env.ENVIRONMENT === 'production',
            sameSite: 'Lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 7, // 1 week
        });
        return { headers };
    }
});
```

**File: `src/index.ts` (Developer's Main Server Entrypoint)**
```typescript
import { Hono } from 'hono';
import { cossack } from '@cossackframework/framework';
import { middleware as authMiddleware, loginHandler } from './auth';

const app = new Hono<{ Bindings: Env, Variables: { user?: User } }>();

// 1. Define Stateless API Routes (e.g., login)
app.post('/api/login', loginHandler);

// 2. Apply Middleware to Protected Component Routes
app.use('/tasks/*', authMiddleware);
app.use('/admin/*', authMiddleware);

// 3. Hand Off All Routing to Cossack's File-Based Router
// This handler will now receive a context that may have a `user` attached.
app.all('*', cossack());

export default app;
```

## 4. Core Refactoring Plan

The `@cossackframework/core` package will be updated to be completely auth-agnostic.

1.  **Remove Mocks:** The current `getAuthenticatedUser` mock will be removed.
2.  **Expect User in Context:** The Hono route handlers within `core` that interface with the Durable Object will be modified to get the user from the context (`c.get('user')`).
3.  **Secure Header Passing:** The logic of passing the authenticated user's data from the Worker to the Durable Object via secure, internal `X-User-*` headers will be formalized. The DO will trust these headers implicitly, as the request originates from our trusted Worker, not the end-user.

## 5. Immediate Next Steps (For Tomorrow)

1.  Create the monorepo directory structure: `mkdir -p packages/core packages/auth packages/framework packages/create-cossack-app`.
2.  Move existing files (`src`, `public`, `tests`, `*.ts`, `*.json`, etc.) into `packages/core`.
3.  Update the root `pnpm-workspace.yaml` to recognize the packages.
4.  Create `package.json` files for all new packages.
5.  Adjust `tsconfig.json` paths for the new monorepo structure.
6.  Begin the implementation of the `@cossackframework/auth` package and the `create-cossack-app` CLI.
