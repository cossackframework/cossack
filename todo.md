TODOs and Future Improvements

## Storage Integration

A lot of users struggle with uploading and managing files (yes, it's hard too)
It's easy to implement storage for Node.js because they have built in `fs` module, but Cloudflare Workers or other serverless, is lack of native file storage.

So, we can create a package that integrates with popular storage solutions like AWS S3, Google Cloud Storage, or Cloudflare R2 (preferred).

### Considerations
- Simple backend's SDK wrappers for file upload/download. Maybe an endpoint like we do with `crpc`.
- Client components for file selection and upload progress, supporting streaming large files with chunked uploads, we might create a `<FileUploader>` component.
- Unstyled components to allow users to style them as they wish, and allowing them to modify to fit their needs (e.g., drag-and-drop support).

## Node Adapter

Currently, in node adapter, we have to manually import all components to build the component registry. This can be improved in the future with automatic discovery or a better registry system.

```typescript
const app = createApp();
const componentRegistry = ...; // Map of ComponentName -> ComponentClass
```

We might consider either:
- Using vite glob imports to automatically gather components.
- Use node's fs module to read the filesystem and dynamically import components.

## Access bindings

Cloudflare Workers support various bindings (KV, Secrets, Env Variables, etc.) that are not yet directly accessible in Cossack components.
We should create a standardized way to access these bindings within Cossack components, possibly through dependency
For example, we can let user to call `this.env.KV_NAMESPACE.get('key')` inside a component method.

## Lifecycle Hooks

Implement lifecycle hooks similar to Qwik `useTask$` and `useVisibleTask$`, or like React's `useEffect` but also runs on the server, allowing running asynchronous operations as part of component initialization or change of component state, or force re-running when certain dependencies change.

See: https://qwik.dev/docs/core/tasks/

Example usage:

```typescript
import { Task, isServer } from '@cossackframework/core';

export default class Page extends Cossack {
    // @Task behavior is similar to Qwik's useTask$
    @Task
    runOnce(() => {
        // This log runs on both server and client, whenever the component is mounted or updated
        console.log('Component mounted or updated');
    });
}
```

Also, we might need to implement `track()`, `cleanup()` utilities to track dependencies and clean up resources when the component is unmounted.
The `@VisibleTask` can be implemented using IntersectionObserver on the client side to detect when the component enters the viewport, we can also run it as soon as the component is loaded on the browser by using `{ strategy: 'document-ready' }` option.

```typescript
import { VisibleTask } from '@cossackframework/core';
export default class Page extends Cossack {
    // @VisibleTask behavior is similar to Qwik's useVisibleTask$
    @VisibleTask({
        strategy: 'document-ready',
    })
    runWhenVisible(({ cleanup }) => {
        // This log runs only on the client, when the component is visible in the viewport
        console.log('Component is now visible in the viewport');
    });
}
```

Also, consider adding `on`, `onDocument`, `onWindow` utilities to listen to events on the component, document, or window level.

- `@On` - listens to click events on the component's root element.
- `@OnDocument` - listens to keydown events on the document.
- `@OnWindow` - listens to resize events on the window.

Example usage:

```typescript
import { On, OnDocument, OnWindow } from '@cossackframework/core';

export default class Page extends Cossack {
    @On('click')
    handleClick(event: Event) {
        console.log('Component clicked!', event);
    }

    @OnDocument('keydown')
    handleKeydown(event: KeyboardEvent) {
        console.log('Key pressed on document!', event.key);
    }

    @OnWindow('resize')
    handleResize(event: UIEvent) {
        console.log('Window resized!', window.innerWidth, window.innerHeight);
    }
}
```

By doing this, we can provide a more reactive and event-driven programming model for Cossack components, or inject any stupid js library that requires DOM access.
Even jQuery can be used inside Cossack components!


## Dev Tools

Qwik has an useful feature, we can Ctrl + Click on the component name in the browser dev tools to open the source code directly in your editor.
So, considering that, we can somehow let user press Ctrl in the browser, and all components can be selectable, when clicked, it will open the source code in the editor (vscode for example). This feature is working only in development mode.

See: https://qwik.dev/docs/guides/debugging/

## Prevent Navigate
Implement a way to prevent navigation based on certain conditions, similar to React Router's `Prompt` component.
This can be useful for scenarios like unsaved form data, where you want to warn the user before they leave the page.

Example usage:

```typescript
import { Cossack, PreventNavigation } from '@cossackframework/core';
export default class Page extends Cossack {
    @State()
    greeting: string = 'Hello, World!';

    @PreventNavigation()
    stopNavigate() {
        if (this.greeting === 'Hello, World!' || this.greeting === '') {
            return confirm('You have unsaved changes. Are you sure you want to leave?');
        }
        return true;
    }

    template() {
        return `
            <input type="text" name="greeting" value="${this.greeting}" />
        `;
    }
}

// OR, consider a better way to customize the prompt area:
export default class Page extends Cossack {
    @State()
    greeting: string = 'Hello, World!';

    @PreventNavigation()
    stopNavigate() {
        // We provide the logic to determine whether to block navigation or not
        // true = allow navigation, false = block navigation
        return this.greeting === 'Hello, World!' || this.greeting === '';
    }

    template() {
        // Then based on the stopNavigate result, we can show a custom prompt UI, we also have custom confirmNavigation method to handle user's choice
        return `
            ${this.stopNavigate() ? `
                <div class="custom-prompt">
                    <p>You have unsaved changes. Are you sure you want to leave?</p>
                    <button @click="${() => this.confirmNavigation(true)}">Yes</button>
                    <button @click="${() => this.confirmNavigation(false)}">No</button>
                </div>
            ` : ''}
            <input type="text" name="greeting" value="${this.greeting}" />
        `;
    }
}
```

## Docs
React to Cossack guide
A guide for React developers to migrate their knowledge to Cossack framework.

## Refs
Implement a way to reference DOM elements directly within Cossack components, similar to React's `useRef` hook.

Example usage:

```typescript
import { Cossack, Ref } from '@cossackframework/core';
export default class Page extends Cossack {
    @Ref()
    inputRef!: HTMLInputElement;

    focusInput() {
        this.inputRef.focus();
    }

    template() {
        return `
            <input type="text" name="greeting" ${this.inputRef} />
            <button onclick="${() => this.focusInput()}">Focus Input</button>
        `;
    }
}
```

## Refactor

Rename `template()` method to `render()` for better clarity and consistency with other frameworks.

## Directives

Implement custom directives similar to Lit.