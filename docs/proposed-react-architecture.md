# Proposed Architecture: Migrating to React

This document outlines a detailed plan for migrating the Cossack framework's rendering layer from `lit-html` to React. The goal is to leverage React's mature ecosystem, particularly its robust solutions for Server-Side Rendering (SSR) and client-side hydration, while retaining the unique and powerful developer experience of our decorator-based, auto-wiring WebSocket system.

## The Core Philosophy

The central idea is to combine the best of both worlds:
-   **React's Rendering Engine:** Offload the incredibly complex problem of SSR, hydration, and component composition to the most battle-tested UI library in the world.
-   **Cossack's State Management:** Keep our intuitive, class-based component model with `@State` and `@Server` decorators, which provides a superior developer experience for managing real-time state compared to React Hooks like `useEffect`.

## The New Component API

Developers will write components as React Class Components that extend a new `CossackReactComponent` base class. The core logic remains remarkably similar to the current system.

### Example: `Greeting` Component Refactored

```tsx
// src/pages/index.tsx (Note the .tsx extension)
import { CossackReactComponent } from '@/shared/cossack-react';
import { State, Server, Page } from '@/shared/decorators';
import { Button } from '@/components/Button'; // This would now be a React component

@Page({ channel: true })
export class Greeting extends CossackReactComponent {
    // The @State decorator still works exactly the same.
    @State() private count: number = 0;
    @State() private name: string = 'World';

    // The @Server decorator is unchanged.
    @Server()
    private increment = async (user: any) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        this.count++;
    };

    // The template() method is replaced by React's standard render() method.
    render() {
        const isLoading = this.loading['increment'];
        
        // We use JSX instead of lit-html's tagged template.
        return (
            <div>
                <p>Hello {this.name} {this.count}</p>
                <Button
                    onClick={this.increment}
                    disabled={isLoading || this.count >= 5}
                >
                    {isLoading ? 'Incrementing...' : 'Increment'}
                </Button>
            </div>
        );
    }
}
```

## Implementation Plan: Step-by-Step

### 1. Project Setup & Dependencies

1.  **Add Dependencies:**
    ```bash
    pnpm add react react-dom
    pnpm add -D @types/react @types/react-dom
    ```
2.  **Update `tsconfig.json`:**
    -   Add `"jsx": "react-jsx"` to the `compilerOptions`.
3.  **Update `vite.config.ts`:**
    -   Add the official React plugin (`@vitejs/plugin-react`) to enable JSX transforms and Fast Refresh.

### 2. The `CossackReactComponent` Base Class

This new class will be the heart of the integration. It will be created at `src/shared/cossack-react.ts`.

```typescript
import React from 'react';
import { State } from './decorators'; // We'll need to modify @State

export abstract class CossackReactComponent extends React.Component {
    // All existing WebSocket connection logic from the original Cossack class
    // will be moved here.
    
    // The @State decorator will be modified to use this.
    @State() public loading: Record<string, boolean> = {};

    componentDidMount() {
        // React's lifecycle hook is the perfect place to connect the WebSocket.
        this.connectWebSocket(); 
    }

    componentWillUnmount() {
        // And to disconnect it.
        this.disconnectWebSocket();
    }

    // The render method is defined by the subclass.
    abstract render(): React.ReactNode;
}
```

### 3. Modifying the `@State` Decorator

This is the most critical part of the integration. The decorator's `set` accessor needs to be updated to trigger React's rendering mechanism.

**Current Logic (in `cossack.ts`):**
```typescript
// ...
set: (newValue) => {
    // ... (state update logic)
    this.render(); // Calls our custom renderer
}
// ...
```

**New Logic (in `cossack-react.ts`):**
```typescript
// ...
set: (newValue) => {
    const state = Cossack._stateMap.get(this)!;
    if (state.get(key) !== newValue) {
        state.set(key, newValue);
        
        // Instead of calling our renderer, we call React's.
        // This is the elegant bridge between our state system and React's VDOM.
        this.forceUpdate();
    }
}
// ...
```
The `forceUpdate()` method is a built-in part of the `React.Component` API that tells React to schedule a re-render, even if the state change didn't come from `this.setState()`.

### 4. Updating the Server-Side Rendering Flow

The server-side code needs to be updated to use React's SSR capabilities.

1.  **`finalHandler` (in `src/router.ts`):**
    -   Replace `renderToString` from our custom renderer with `ReactDOMServer.renderToString`.
    -   The component instance will be created and passed to this method as a JSX element: `renderToString(<PageComponent />)`.

2.  **`root.ts`:**
    -   This file will still be responsible for creating the final HTML shell, but it will now inject the React-rendered string.

### 5. Updating the Client-Side Hydration Flow

The client-side entry point is the final piece.

1.  **`entry-client.ts`:**
    -   Instead of calling our custom `render` function, we will use `ReactDOM.hydrateRoot`.
    -   This method takes the server-rendered HTML and "attaches" React to it, making it interactive without re-rendering the entire DOM.
    -   We will need to find the root element (e.g., `<div id="root">`) and pass it to `hydrateRoot` along with the top-level component: `hydrateRoot(document.getElementById('root'), <PageComponent />)`.

This plan provides a comprehensive, step-by-step guide to achieving the architectural migration. It preserves the powerful and unique DX of our framework while leveraging the stability and ecosystem of React.
