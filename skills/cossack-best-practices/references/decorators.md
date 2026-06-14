# Decorators API Reference

All decorators are imported from `@cossackframework/core` unless otherwise noted.

## Class Decorators

### `@Page(options?)`

Marks a class as a page component. Applied to route pages and layouts.

```typescript
@Page({
    transport: 'http',          // 'http' | 'durable-object' | 'websocket' | 'sse'
    stateful: false,            // boolean — persist state in DO storage (only with 'durable-object')
    middlewares: [],            // MiddlewareHandler[] — server middleware
    channels: ['global'],       // string[] — state channels for real-time
    providers: {},              // { [key: string]: StateProvider }
    route?: '',                 // Override the file-based route
    ssg?: false,                // boolean | SsgOptions — static generation
})
export class MyPage extends Cossack { ... }
```

### `@Component(options?)`

Marks a class as a reusable component. Semantically distinct from `@Page` for future tooling; same options.

```typescript
@Component({ transport: 'http' })
export class Button extends Cossack { ... }
```

### `@Service(options?)`

Marks a class as an injectable service for dependency injection.

```typescript
@Service({ scope: 'singleton' })  // 'singleton' | 'transient'
export class PaymentService { ... }
```

## Property Decorators

### `@State(options?)`

Server-synced state. Initialized on the server, automatically synced to the client. Changes in `@Server()` methods trigger re-renders on all connected clients.

```typescript
@State()
count: number = 0;

@State({ channel: 'feeds' })
feedCount: number = 0;

@State({ provider: 'user-session' })
userPrefs: Record<string, string> = {};
```

Options:
- `channel?: string` — Channel for partial updates (default: `'global'`)
- `provider?: string` — State provider name (default: `'page'`)

### `@ClientState()`

Client-only reactive state. Triggers re-renders locally. Never sent to the server.

```typescript
@ClientState()
isOpen: boolean = false;
```

### `@Prop()`

Semantic equivalent to `@ClientState()`. Indicates a component input from a parent. Use in reusable components.

```typescript
@Prop()
variant: 'primary' | 'secondary' = 'primary';
```

### `@Validate(options?)`

Adds validation rules to a `@State` or `@ClientState` property. Must be stacked on top of the state decorator. See `validation.md` for the full guide.

```typescript
@State()
@Validate({
    rules: { required: true, email: true, message: 'Invalid email' },
    config: { trigger: 'all', runOn: 'both' }
})
email: string = '';
```

Validation rules:
| Rule | Type | Description |
|------|------|-------------|
| `required` | `boolean` | Field must not be empty |
| `minLength` | `number` | Minimum string/array length |
| `maxLength` | `number` | Maximum string/array length |
| `min` | `number` | Minimum numeric value |
| `max` | `number` | Maximum numeric value |
| `pattern` | `RegExp` | Must match regex |
| `email` | `boolean` | Must be a valid email |
| `url` | `boolean` | Must be a valid URL |
| `custom` | `(value) => boolean` | Custom sync validator |
| `customAsync` | `(value, component?) => Promise<boolean>` | Custom async validator |
| `message` | `string` | Error message (applies to first failing rule) |

Config options:
| Option | Values | Default |
|--------|--------|---------|
| `trigger` | `'input' \| 'blur' \| 'submit' \| 'all'` | `'all'` |
| `runOn` | `'client' \| 'server' \| 'both'` | `'both'` |
| `errorProperty` | `string` | `'errors'` |
| `debounce` | `number` (ms) | `0` |

### `@Ref()`

Creates a ref object for direct DOM element access.

```typescript
@Ref()
inputRef: Ref<HTMLInputElement>;

onMount() {
    this.inputRef.value?.focus();
}
```

## Method Decorators

### `@Server(options?)`

Marks a method as server-only. On the client, the method body is replaced with a proxy that calls the server via WebSocket or HTTP.

```typescript
@Server()
async fetchData() {
    // This code only runs on the server
    this.data = await db.query();
}

@Server({ channel: 'feeds' })
async updateFeeds() {
    this.feedCount++;
}
```

Options:
- `channel?: string` — Channel for the action (default: `'global'`)
- `provider?: string` — State provider (default: `'page'`)

### `@Client(options?)`

Marks a method as client-only. On the server, the method body is replaced with a no-op. Can be called from `@Server()` methods to invoke on all connected clients.

```typescript
@Client()
toggleMenu() {
    this.isOpen = !this.isOpen;
}

@Client({ channel: 'tasks' })
showAlert(message: string) {
    alert(message);
}
```

Options:
- `channel?: string` — Channel (default: `'global'`)

### `@Shared()`

Marks a method as safe for both client and server. Full implementation is retained in both bundles. Use for pure functions, validation logic, and data transformation.

```typescript
@Shared()
formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
}
```

### `@Computed()`

Marks a getter as a computed property. Memoized — recomputed only when dependent state changes.

```typescript
@Computed()
get fullName() {
    return `${this.firstName} ${this.lastName}`;
}
```

### `@Optimistic(actionName)`

Links a client-side handler to a `@Server()` method for instant UI feedback. Runs immediately on the client before the server responds.

```typescript
@Server()
async increment() {
    await new Promise(r => setTimeout(r, 500));
    this.count++;
}

@Optimistic('increment')
applyOptimisticIncrement() {
    if (!this.loading['increment']) {
        this.optimisticCount = this.count;
    }
    this.optimisticCount++;
}
```

### `@OnEvent(eventName)`

Registers a method as a handler for a broadcast event. Used with real-time transport.

```typescript
@OnEvent('tasks:changed')
async onTasksChanged() {
    await this.init();
}
```

### `@On(eventName)`

Registers a method as a handler for a DOM event on the component's root element.

```typescript
@On('click')
handleRootClick(event: MouseEvent) {
    // ...
}
```

### `@OnDocument(eventName, options?)`

Registers a method as a handler for a document-level event. Automatically cleaned up on component destruction.

Options:
- `throttle?: number` — Minimum interval (ms) between handler calls
- `debounce?: number` — Delay (ms) before handler fires after last event

```typescript
@OnDocument('keydown')
handleGlobalKeydown(event: KeyboardEvent) { /* ... */ }

@OnDocument('mousemove', { throttle: 100 })
handleMouseThrottled(event: MouseEvent) { /* fires at most once every 100ms */ }
```

### `@OnWindow(eventName, options?)`

Registers a method as a handler for a window-level event. Automatically cleaned up on component destruction.

Options:
- `throttle?: number` — Minimum interval (ms) between handler calls
- `debounce?: number` — Delay (ms) before handler fires after last event

```typescript
@OnWindow('resize')
handleResize() {
    this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
}

@OnWindow('scroll', { throttle: 200 })
handleScrollThrottled() { /* at most once every 200ms */ }

@OnWindow('resize', { debounce: 150 })
handleResizeDebounced() { /* 150ms after user stops resizing */ }
```

### `@Task()`

Registers a method to run as a background task after component mount.

### `@VisibleTask(options?)`

Registers a method to run when the component becomes visible in the viewport.

Options:
- `strategy?: 'intersection-observer' | 'document-ready'`
- `threshold?: number`
- `selector?: string`

### `@PreventNavigation()`

Prevents browser navigation while the method's condition is true.

## Helper Functions

### `defineServerMiddleware(handler)`

Semantic wrapper for server middleware. From `@cossackframework/core`.

```typescript
const myMiddleware = defineServerMiddleware(async (c, next) => {
    console.log(c.req.path);
    await next();
});
```

### `createTypedDecorators<T>()`

Creates typed versions of `@State` and `@Server` with channel name autocomplete.

```typescript
const { State, Server } = createTypedDecorators<{ Channels: 'feeds' | 'notifications' }>();
```

### `createAuth<User>(provider)`

Creates an auth kit with middleware and login handler. From `@cossackframework/auth`.

### `Image(props)`

Image optimization helper. From `@cossackframework/core`.

```typescript
Image({
    src: '/photo.jpg',
    width: 600,
    height: 400,
    fit: 'cover',
    quality: 80,
    format: 'webp',
    alt: 'Description',
    loading: 'lazy',
})
```

### `component(clazz, props?, children?)`

Component instantiation helper. From `@cossackframework/renderer`.

```typescript
component(Button, { variant: 'primary', '@click': handler }, 'Click Me')
```
