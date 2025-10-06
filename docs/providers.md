# State Providers: Managing State Context

A **State Provider** is the core architectural concept in Cossack that answers the question: *"Where does my state live?"*

It is a class that decouples your component from the underlying stateful backend (the Durable Object). Its single most important job is to provide the logic for determining **which** Durable Object a component should connect to for a specific piece of state or a server action.

This powerful abstraction is what allows Cossack to move beyond the simple "one-DO-per-URL" model and support sophisticated, shared state scenarios like user sessions or global application state.

---

## The Default: `PageStateProvider`

For convenience and simplicity, Cossack comes with a default provider called `PageStateProvider`.

**Behavior:**
-   If you do **not** specify any providers in your `@Page` decorator, the framework automatically registers an instance of `PageStateProvider` for you under the name `page`.
-   Its `getDurableObjectId()` method uses the component's `page` prop (derived from the URL) to generate a Durable Object ID.
-   This scopes the state directly to the URL, making it perfect for content pages, blog posts, or any context where the state is unique to that specific page.

This is why the following code works out-of-the-box without any extra configuration:

```typescript
import { Page, Server, State } from '@cossackframework/core';

@Page() // No provider specified, so PageStateProvider is used by default.
export class MyPage extends Cossack {

    // This state is managed by the PageStateProvider.
    @State() 
    private pageTitle: string = '';

    // This action is sent to the Durable Object associated with the current page.
    @Server()
    private async updateTitle(newTitle: string) {
        this.pageTitle = newTitle;
    }
}
```

---

## How to Write a Custom Provider

The true power of the provider model is realized when you create your own. Let's walk through the most common use case: creating a `UserSessionProvider` to manage state that is shared across all pages for a single logged-in user (e.g., a shopping cart or notification count).

### Step 1: Create the Provider Class

Create a new class that extends the `StateProvider` base class.

```typescript
// src/providers/UserSessionProvider.ts

import { StateProvider } from '@cossackframework/core';
import type { DurableObjectId } from '@cloudflare/workers-types';

export class UserSessionProvider extends StateProvider {
  // We will implement this method next.
  getDurableObjectId(): DurableObjectId {
    // ...
  }
}
```

### Step 2: Implement `getDurableObjectId()`

This is where the core logic lives. For a session provider, we want to create a unique Durable Object for each user. The best way to do this is to use the user's ID.

The `StateProvider` base class gives you access to the component instance via `this.component` and the environment bindings via `this.env`.

```typescript
// src/providers/UserSessionProvider.ts

import { StateProvider } from '@cossackframework/core';
import type { DurableObjectId, DurableObjectNamespace } from '@cloudflare/workers-types';

export class UserSessionProvider extends StateProvider {
  getDurableObjectId(): DurableObjectId {
    // 1. Get the user's ID from the component instance.
    const userId = this.component.user?.id;
    if (!userId) {
      throw new Error("User is not authenticated. Cannot create session state.");
    }

    // 2. Get the Durable Object namespace from your environment bindings.
    //    (You must bind this in your wrangler.jsonc file).
    const sessionDurableObject = this.env.SESSION_DO as DurableObjectNamespace;
    if (!sessionDurableObject) {
        throw new Error("Durable Object namespace 'SESSION_DO' not found in environment bindings.");
    }

    // 3. Create a unique, stable ID from the user's ID.
    //    Every component, on any page, for this user will now get the same ID.
    return sessionDurableObject.idFromName(userId);
  }
}
```

### Step 3: Register Your Provider

In your component, import your new provider and add it to the `providers` object in the `@Page` decorator. You must give it a unique name (e.g., `session`).

```typescript
import { UserSessionProvider } from '../providers/UserSessionProvider';

@Page({
  providers: {
    session: new UserSessionProvider()
    // The default 'page' provider is still available automatically.
  }
})
export class MyComponent extends Cossack {
  // ...
}
```

### Step 4: Use Your Provider

Now, you can use the `provider` property in the `@State` and `@Server` decorators to target your custom provider.

```typescript
@Page({
  providers: {
    session: new UserSessionProvider()
  }
})
export class HeaderComponent extends Cossack {

  // This state lives in the page-specific DO.
  @State({ provider: 'page' }) // or just @State()
  private pageTitle: string = 'Dashboard';

  // This state lives in the user's session DO and is shared across all pages.
  @State({ provider: 'session' })
  private notificationCount: number = 0;

  // This action is sent to the user's session DO.
  @Server({ provider: 'session' })
  private async markNotificationsAsRead() {
    this.notificationCount = 0;
  }
}
```

With this setup, `pageTitle` will be unique to each page the user visits, but `notificationCount` will be the same, persistent value for that user no matter which page they are on.
