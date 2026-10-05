---
title: "Test utilities"
description: "Exercise real request dispatch, component hydration and cleanup with public test helpers."
---

# Test utilities

Install `@cossackframework/test-utils` alongside your application's framework
packages. Its server entry requires Node.js. The browser entry uses the DOM and
can run in Vitest's jsdom environment or a real browser.

## Test the production request handler

Inject your application's real fetch handler. The helper creates ordinary
`Request` objects and passes the same environment bindings to that handler.
It does not replace routing, authentication, authorization, service scopes,
configuration scoping or response cleanup.

```ts
import { authFixture, createServerApp, readHydrationState } from '@cossackframework/test-utils/server';
import worker from './src/server';

const app = createServerApp({
  fetch: (request, env) => worker.fetch(request, env),
  env: { APP_URL: 'https://app.test' },
  baseUrl: 'https://app.test',
});
const credentials = authFixture({ cookies: { session: 'your-test-session-token' } });
const response = await app.request('/dashboard', credentials);
const hydration = readHydrationState(await response.text());

const result = await app.componentRpc({
  componentRouteId: 'the-route-id-from-hydration',
  action: 'save',
  payload: [{ title: 'Example' }],
  state: {},
}, credentials);
```

For an application created with the framework router, inject
`fetch: (request, env) => application.fetch(request, env)` instead. Keep the
application's real configuration and middleware. `authFixture` attaches headers
and cookies; it does not create a user or grant permission. Create test session
tokens with your authentication provider, or configure explicit test middleware
in the test application's source.

`componentRpc` sends the production JSON envelope to `/crpc`. `serviceRpc`
accepts `ownerRouteId`, `slot`, `action`, optional `payload`, `state` and
`scopeKey`; it sends the same scoped-service envelope as the browser proxy.
The default Origin is the application's base origin. Supply a different Origin
in the second argument to test rejection. Raw `request()` supports other
methods, multipart uploads and abort signals. Read or cancel streaming response
bodies to let the real handler finish response-owned cleanup.

`readHydrationState` parses the JSON in the production
`window.__INITIAL_STATE__` assignment. It never evaluates JavaScript. Missing
state returns `undefined`; malformed or duplicate assignments throw. Its generic
type parameter is your expected shape, not runtime validation.

## Render and hydrate a component

```ts
import { render } from '@cossackframework/test-utils/browser';

const view = await render(Counter, {
  state: { public: { count: 3 } },
  props: { label: 'Test counter' },
  serviceScope: layoutScope,
  ownsServiceScope: true,
});
await view.click('button');
await view.type('input', 'edited');
await view.waitForUpdate();
await view.unmount();
```

The helper uses core constructor injection and the production bootstrap method.
Pass a real `ServiceScope` when the component injects layout services. Set
`ownsServiceScope: true` only when this component should dispose that scope;
otherwise dispose the externally owned scope yourself. State uses the normal
hydration envelope, including `public` and any production metadata. Bootstrap
options such as context, user and environment retain their production meaning;
browser identity comes from hydrated metadata.

`unmount()` is awaitable and idempotent. It waits for component, descendant and
owned-service cleanup, and removes the DOM even if cleanup fails. Failed
bootstrap also removes the container and attempts component cleanup.

## Control asynchronous work

`controlledAsync<T>()` gives you a promise, resolve/reject methods, cancellation,
an abort signal and a settlement flag. An optional finite nonnegative
`timeoutMs` bounds the wait. Use gates to exercise concurrent requests and late
results without fixed sleeps.

`withRequestScope()` scopes core request-context getters and service facilities
using AsyncLocalStorage and awaits cleanup. It does not supply framework
configuration, router middleware, authentication or policy checks. Use
`createServerApp` with the production handler to test those features.

## Limits of simulation

jsdom can prove component state, DI, hydration and cleanup behavior. It cannot
prove layout, browser networking, CSP, real navigation, WebSocket behavior or
Workers bindings. Keep real browser and workerd acceptance tests. A simulated
fetch handler cannot prove server-code stripping: build the application with
the production compiler and inspect its client output. Published-package
acceptance must install tarballs without repository aliases.
