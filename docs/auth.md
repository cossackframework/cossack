# Authentication

The `@cossackframework/auth` package provides a minimal, flexible, and unopinionated interface for handling authentication in your Cossack application. It is designed to work seamlessly with Hono and allows you to implement any authentication strategy (Session/Cookie, JWT, OAuth, etc.) while providing a standardized way to protect your routes and components.

## Core Concepts

The library allows you to create an **Auth Kit** by providing an **Auth Provider**.

*   **Auth Provider**: A set of functions that define *how* to extract a session, validate it, and fetch the user.
*   **Auth Kit**: The result of `createAuth`, containing:
    *   `middleware`: Hono middleware that runs on every request to populate `c.get('user')`.
    *   `createLoginHandler`: A helper to generate a secure login route handler.

## Example: Email/Password with Cookie Sessions

This example demonstrates a standard authentication flow:
1.  **Login**: User sends email/password. System verifies them, creates a session in the DB, and sets an HTTP-only cookie.
2.  **Request**: User makes a request. System reads the cookie, verifies the session in the DB, and attaches the User object to the context.

### 1. Define Your Types

First, define what your User and Session look like. These usually map to your database tables.

```typescript
export type User = {
    id: string;
    name: string;
    email: string;
    // Password should be hashed in the real DB!
    password: string; 
};

export type Session = {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
};
```

### 2. Configure Authentication

Create a file (e.g., `src/auth.ts`) to configure your authentication logic using `createAuth`.

```typescript
import { createAuth } from '@cossackframework/auth';
import { getCookie } from 'hono/cookie';
import { db } from './db'; // Your imaginary database client
import type { User } from './types';

export const { middleware, createLoginHandler } = createAuth<User>({
    // 1. Extract the session ID (token) from the request
    extractSessionId: (c) => {
        return getCookie(c, 'session_token');
    },

    // 2. Validate the session ID against your database
    validateSessionId: async (sessionId, c) => {
        // Query your sessions table
        const session = await db.sessions.find({ token: sessionId });
        
        // Check if session exists and is not expired
        if (!session || session.expiresAt < new Date()) {
            return null;
        }
        
        // Return the User ID associated with the session
        return session.userId;
    },

    // 3. Fetch the full user object
    resolveUserById: async (userId, c) => {
        const user = await db.users.find({ id: userId });
        // Return the user object (or null if not found)
        return user || null;
    }
});
```

### 3. Create a Login Route

Export a login handler using the `createLoginHandler` utility. This handler will parse the JSON body for credentials, verify them, and then allow you to set headers (like `Set-Cookie`).

```typescript
// src/auth.ts

import { setCookie } from 'hono/cookie';

export const loginHandler = createLoginHandler({
    // 1. Verify credentials (email/password)
    validateCredentials: async (credentials, c) => {
        const { email, password } = credentials;
        const user = await db.users.find({ email });

        // In a real app, use bcrypt or argon2 to verify the password hash!
        if (user && user.password === password) {
            return user;
        }
        return null;
    },

    // 2. Create a session and return headers (cookies)
    createSession: async (user, c) => {
        // Generate a secure random token
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week

        // Store session in DB
        await db.sessions.create({
            token,
            userId: user.id,
            expiresAt
        });

        // Set the secure HTTP-only cookie
        const headers = new Headers();
        setCookie(headers as any, 'session_token', token, {
            httpOnly: true,
            secure: true, // true in production (HTTPS)
            sameSite: 'Lax',
            path: '/',
            expires: expiresAt,
        });

        return { headers };
    }
});
```

### 4. Integrate with Your App

Finally, attach the middleware and login route to your main Hono application in `src/index.ts`.

```typescript
import { Hono } from 'hono';
import { middleware as authMiddleware, loginHandler } from './auth';
import { createApp } from '@cossackframework/framework';

const app = createApp();

// Add the auth middleware globally or to specific routes
app.use('*', authMiddleware);

// Define the login endpoint
app.post('/api/login', loginHandler);

// ... rest of your app ...
```

Now, any request handled by `cossack` (your pages and components) will have access to `this.user` if the user is logged in.

## Using Authenticated User in Components

In your Cossack components, the authenticated user is automatically available on the instance.

```typescript
import { Cossack, Page, Server } from '@cossackframework/core';

@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) {
            // Redirect unauthenticated users
            this.redirect('/login');
            return;
        }
        
        console.log(`Welcome back, ${this.user.name}`);
    }
}
```
