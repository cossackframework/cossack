# Services & Dependency Injection

Services are reusable classes that hold state and business logic, injected into page and layout components via constructor parameters. They support the same decorators as components (`@State`, `@Server`, `@Client`, `@Shared`, etc.) and share the component's RPC transport automatically.

## Basic Usage

### 1. Define a Service

Decorate a class with `@Service()` and use `@State`, `@Server`, and other decorators just like you would in a component:

```typescript
import { Service, State, Server, Shared } from '@cossackframework/core';

@Service()
export class CounterService {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
    }

    @Shared()
    formatCount(): string {
        return `Count: ${this.count}`;
    }
}
```

### 2. Inject into a Component

Declare the service as a constructor parameter. TypeScript's `emitDecoratorMetadata` (already enabled in the project tsconfig) captures the type, and the framework resolves it automatically:

```typescript
import { Page, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { CounterService } from '../services/CounterService';

@Page()
export default class CounterPage extends Cossack {
    constructor(private counterService: CounterService) {
        super();
    }

    render() {
        return html`
            <button @click=${() => this.counterService.decrement()}>-</button>
            <span>${this.counterService.formatCount()}</span>
            <button @click=${() => this.counterService.increment()}>+</button>
        `;
    }
}
```

That's it. The framework handles instantiation, state synchronization, and RPC proxying.

## How It Works

### Instantiation

When the framework creates a component (during SSR, CRPC handling, or client hydration), it uses `createInstance(ComponentClass)` instead of `new ComponentClass()`. This helper reads constructor parameter types from `reflect-metadata` and resolves any `@Service()` dependencies from the DI container.

### Server-Side

1. The service is instantiated and injected into the component.
2. The component gets **forwarding methods** for each `@Server`-only method on the service. When the CRPC handler calls `componentInstance.increment()`, it delegates to `serviceInstance.increment()`.
3. Service `@State` properties are registered on the component's state container, so `getPublicState()` returns service state alongside component state.

### Client-Side

1. The service is instantiated and injected during client hydration.
2. `@Server`-only methods are replaced with HTTP fetch proxies that call `/crpc` using the parent component's `componentRouteId`.
3. `@Shared` methods keep their full implementation and run locally.
4. When the server responds with updated state, values are synced back to the service instance and the component re-renders.

## Decorator Support

Services support the same decorators as components:

| Decorator | Behavior in Services |
| :--- | :--- |
| `@State()` | Synchronized state. Changes on the server are returned to the client after RPC calls. |
| `@Server()` | Server-only method. Proxied via HTTP on the client. Body is stripped from client bundle. |
| `@Client()` | Client-only method. Stubbed on the server. |
| `@Shared()` | Runs on both sides with full implementation. Not proxied. |
| `@Computed()` | Memoized getter. Runs locally on both sides. |

### `@Shared` vs `@Server`

Use `@Shared` for pure functions and data formatting that must run on the client without a network round-trip. Use `@Server` for methods that access databases, external APIs, or other server-only resources.

```typescript
@Service()
export class CartService {
    @State() items: CartItem[] = [];

    @Server()
    async addItem(productId: string) {
        // Runs on server only — can access database
        const product = await db.products.findById(productId);
        this.items.push(product);
    }

    @Shared()
    get total(): number {
        // Runs locally on both client and server — no RPC needed
        return this.items.reduce((sum, item) => sum + item.price, 0);
    }
}
```

## Service Scopes

### Singleton (Default)

All services are singletons by default. If multiple components inject the same service class, they share the same instance:

```typescript
@Service() // scope: 'singleton' (default)
export class AuthService {
    @State() user: User | null = null;

    @Server()
    async login(email: string, password: string) { /* ... */ }
}
```

### Transient

Use `{ scope: 'transient' }` when each injection should get its own instance:

```typescript
@Service({ scope: 'transient' })
export class FormValidationService {
    @State() errors: Record<string, string> = {};
    // Each component gets its own error state
}
```

## Service-to-Service Injection

Services can depend on other services through constructor injection:

```typescript
@Service()
export class LoggerService {
    logs: string[] = [];
    log(msg: string) { this.logs.push(msg); }
}

@Service()
export class PaymentService {
    @State() status = 'idle';

    constructor(private logger: LoggerService) {}

    @Server()
    async processPayment(amount: number) {
        this.logger.log(`Processing payment: $${amount}`);
        this.status = 'processing';
        // ... payment logic
        this.status = 'completed';
    }
}
```

The DI container resolves the full dependency graph automatically and detects circular dependencies.

## Multiple Services in One Component

A component can inject multiple services:

```typescript
@Page()
export default class Checkout extends Cossack {
    constructor(
        private cartService: CartService,
        private paymentService: PaymentService,
        private authService: AuthService,
    ) {
        super();
    }

    render() {
        if (!this.authService.user) {
            return html`<p>Please log in</p>`;
        }

        return html`
            <ul>
                ${this.cartService.items.map(item => html`<li>${item.name}</li>`)}
            </ul>
            <p>Total: $${this.cartService.total}</p>
            <button @click=${() => this.paymentService.processPayment(this.cartService.total)}>
                Pay Now (${this.paymentService.status})
            </button>
        `;
    }
}
```

## Security

The Vite security plugin automatically processes `@Service` classes the same way it handles components:

- `@Server` method bodies are **stripped** from the client bundle and replaced with stubs.
- `@Shared` and `@Client` methods retain their full implementation.
- Methods without decorators are treated as server-only (secure by default).

This means database queries, API keys, and server-side business logic inside services are never exposed to the browser.

## File Convention

Services are typically placed in `src/services/`:

```
src/
  services/
    CounterService.ts
    AuthService.ts
    CartService.ts
  pages/
    checkout/
      index.ts
```

There is no auto-discovery — import services explicitly in the components that use them.

## Limitations

- Services must be injected via **constructor parameters** with TypeScript parameter properties (e.g., `constructor(private service: MyService)`). The framework uses `emitDecoratorMetadata` to resolve types at runtime.
- Services do not have their own RPC channel. They share the parent component's transport (`http` or `durable-object`).
- `@State` properties on services are scoped to the parent component's lifecycle. On HTTP transport, state resets on page reload (same as component state).
- Services cannot use lifecycle hooks like `onMount()` or `onCleanup()`. Use the parent component's hooks instead.
