# Cossack Framework Improvements Plan

> Created after fixing the `@Server()` proxy bug for nested components. This document outlines recommended improvements to make the framework more robust, maintainable, and developer-friendly.

---

## Priority Legend

- **P0 - Critical**: Bug fixes, security issues, breaking inconsistencies
- **P1 - High**: Major improvements that prevent bugs or significantly improve DX
- **P2 - Medium**: Nice-to-have features, code quality improvements
- **P3 - Low**: Minor enhancements, can be done incrementally

---

## P0 - Immediate Fixes

### 1. Apply State Sync Fix to `/upload` Endpoint

**Issue**: The `/crpc` endpoint was fixed to properly apply state to the target component, but the `/upload` endpoint has the same issue.

**Files**: `packages/framework/src/router.ts`

```typescript
// Add this to the /upload endpoint after finding targetInstance:
for (const key in state) {
    (targetInstance as any)[key] = state[key];
}
```

---

## P1 - High Priority

### 2. Simplify State Management Flow

**Problem**: State is passed through too many concepts (`_restoredChildrenState`, `initialState`, `getInitialState()`, `getPublicState()`). This makes reasoning about state flow difficult.

**Proposal**: Unify state concepts with clearer naming and single source of truth.

```typescript
interface ComponentState {
  // Public state (synced server-client)
  public: Record<string, unknown>;
  // Internal state (not synced)
  internal: Record<string, unknown>;
  // Children state (nested components)
  children: Record<string, ComponentState>;
}
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 3. Reduce Lifecycle Method Complexity

**Problem**: The interaction between `connectedCallback()`, `willUpdate()`, `bootstrap()`, and `initializeState()` caused the proxy bug.

**Proposal**: Introduce explicit lifecycle phases with guards.

```typescript
enum LifecyclePhase {
  Creating,      // Constructor
  Bootstrapping, // bootstrap() called
  Mounted,       // connectedCallback() done
  Updating,      // willUpdate() in progress
  Destroyed      // cleanup done
}

// Add phase guards to prevent invalid state transitions
private _phase: LifecyclePhase = LifecyclePhase.Creating;
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 4. Replace `any` Type Casts with Proper Types

**Problem**: Heavy use of `(this as any)` makes code error-prone and loses type safety.

**Proposal**: Define proper internal interfaces.

```typescript
interface CossackElementInternal {
  __parent?: CossackElement;
  registerComponent(comp: CossackElement): void;
  _id: string;
  _restoredChildrenState: Record<string, unknown>;
  activeComponents: Map<string, CossackElement>;
}
```

**Files**: `packages/core/src/shared/cossack.ts`, `packages/renderer/src/cossack-element.ts`

---

## P2 - Medium Priority

### 5. Add Error Boundaries

**Problem**: Errors in nested components can crash the entire page with no graceful degradation.

**Proposal**: Add error boundary pattern.

```typescript
@Page()
class MyPage extends Cossack {
  @State()
  error?: { component: string; message: string; stack?: string };

  // Automatically catch child component errors
  onError(error: Error, component: Cossack) {
    this.error = {
      component: component.constructor.name,
      message: error.message,
      stack: error.stack
    };
  }

  render() {
    if (this.error) {
      return html`<error-display .error=${this.error} />`;
    }
    return this.template();
  }
}
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 6. Unified Proxy Pattern

**Problem**: `proxyHttpMethods()` and `proxyServerMethods()` have similar logic but are separate.

**Proposal**: Unified proxy interface with transport abstraction.

```typescript
interface ProxyConfig {
  transport: 'http' | 'websocket';
  endpoint?: string;
  provider?: string;
  timeout?: number;
}

@Server({ transport: 'http' })
async myMethod() { }

// Framework handles both transports uniformly
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 7. Proper Debug/Logging System

**Problem**: Debugging required scattered console.log statements that needed cleanup.

**Proposal**: Structured debug system with categories.

```typescript
// Enable debug categories
Cossack.debug.enable('state', 'proxy', 'lifecycle');

// Or via environment variable
COSSACK_DEBUG=state,proxy,lifecycle

// In code:
this.debug('state', 'State updated', { count: this.count });
this.debug('proxy', 'Calling server method', { method: 'increment' });
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 8. Improve Component Registration Pattern

**Problem**: The `__parent` vs `RootContext` pattern caused bugs and is confusing.

**Proposal**: Automatic parent-child registration via DOM hierarchy.

```typescript
// No need for manual registerComponent() calls
// Framework automatically tracks parent-child via DOM
@Page()
class ParentPage extends Cossack {
  render() {
    return html`
      <nested-counter id="counter1"></nested-counter>
    `;
  }
}
```

**Files**: `packages/core/src/shared/cossack.ts`, `packages/renderer/src/cossack-html.ts`

---

## P3 - Low Priority

### 9. State Validation

**Problem**: No runtime validation for state changes.

**Proposal**: Add validation decorators or schema support.

```typescript
@State({ validate: (value) => value >= 0 })
count: number = 0;

// Or with Zod
@State({ schema: z.number().min(0).max(100) })
progress: number = 0;
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 10. Improved Optimistic UI Pattern

**Problem**: Current optimistic handler requires separate method.

**Proposal**: Built-in optimistic updates with automatic rollback.

```typescript
// Current
@Server()
@Optimistic('incrementOptimistic')
async increment() { }

incrementOptimistic() {
  this.count++;
}

// Proposed
@Server({ optimistic: true })
async increment() {
  // Framework automatically handles rollback on error
  this.count++;
}
```

**Files**: `packages/core/src/shared/cossack.ts`

---

### 11. Component State DevTools

**Problem**: Hard to debug state flow between server and client.

**Proposal**: Browser DevTools extension or in-app inspector.

```typescript
// In development, show state inspector
Cossack.devtools.show();
```

---

### 12. Performance Monitoring

**Problem**: No visibility into component render performance or proxy latency.

**Proposal**: Built-in performance metrics.

```typescript
@Server({ trackPerformance: true })
async slowOperation() {
  // Automatically logs execution time
}
```

---

## Implementation Order Recommendation

1. **P0**: Apply `/upload` endpoint fix (quick, prevents similar bugs)
2. **P1**: Lifecycle simplification (prevents whole class of bugs)
3. **P1**: Type safety improvements (better DX, catch errors at compile time)
4. **P2**: Debug system (makes future debugging easier)
5. **P2**: Error boundaries (better UX)
6. **P2**: Unified proxy pattern (code quality)
7. **P3**: State validation, optimistic UI, DevTools (incremental improvements)

---

## Notes from Bug Fix Session

- The root cause of the `@Server()` proxy bug was that `willUpdate()` was calling `registerSelf()`, which re-initialized components with old restored state
- The fix required understanding multiple interconnected systems: lifecycle, state restoration, proxy creation, and component registration
- Better separation of concerns would have made this bug easier to prevent and fix

---

## Related Files

- `packages/core/src/shared/cossack.ts` - Core framework
- `packages/renderer/src/cossack-element.ts` - Base element class
- `packages/renderer/src/cossack-html.ts` - SSR rendering
- `packages/framework/src/router.ts` - Server-side routing and RPC endpoints
- `packages/framework/src/client/app.ts` - Client-side app bootstrap
