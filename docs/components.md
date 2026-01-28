# Components

In Cossack, reusable components are built using the same `Cossack` base class as pages, but they are used differently within the template. This guide explains how to create, use, and manage state in reusable components.

## Creating a Component

To create a component, extend the `Cossack` class. You can use standard decorators like `@Prop`, `@State`, and `@ClientState`.

### Basic Example: Button

```typescript
import { html } from "@cossackframework/renderer";
import { Cossack, Prop } from "@cossackframework/core";

export class Button extends Cossack {
    // 1. Define inputs using @Prop
    @Prop()
    variant: 'primary' | 'secondary' = 'primary';

    @Prop()
    disabled: boolean = false;

    render() {
        // 2. Access props via `this.props` to spread "rest" attributes (like class, style, onClick)
        // Note: We extract known props to avoid spreading them as attributes if they are already handled.
        const { variant, disabled, ...rest } = this.props;

        return html`
            <button 
                data-variant="${this.variant}" 
                ?disabled="${this.disabled}" 
                ...=${rest}
            >
                ${this.children}
            </button>
        `;
    }
}
```

### Components with Internal State: FileUploader

Components can have their own internal state using `@ClientState` (for UI state) or `@State` (if connected to a provider, though typically reusable components use client state or props).

```typescript
import { html } from "@cossackframework/renderer";
import { Cossack, Prop, ClientState } from "@cossackframework/core";

export class FileUploader extends Cossack {
    // Inputs from parent
    @Prop()
    uploading: boolean = false;

    @Prop()
    progress: number = 0;

    // Callback for parent action
    @Prop()
    onUpload?: (file: File) => void;

    // Internal UI state
    @ClientState()
    selectedFile: File | null = null;

    render() {
        return html`
            <div class="file-uploader">
                <input type="file" @change="${(e: any) => this.selectedFile = e.target.files[0]}" />
                
                <button 
                    ?disabled="${!this.selectedFile || this.uploading}"
                    @click="${() => this.onUpload?.(this.selectedFile!)}"
                >
                    ${this.uploading ? `Uploading ${this.progress}%` : 'Upload'}
                </button>
            </div>
        `;
    }
}
```

## Using Components

To use a class-based component within a template, use the `component()` helper function from `@cossackframework/renderer`.

```typescript
import { html, component } from "@cossackframework/renderer";
import { Button } from "./components/Button";

// Inside your Page's render method:
html`
    <div>
        ${component(Button, { variant: 'secondary', onClick: this.handleClick }, 'Click Me')}
    </div>
`
```

### Passing State (Parent to Child)

Data flows down via properties. When the parent state changes, the `render` method re-runs, and `component()` is called with new values. The child component detects these changes and updates efficiently.

```typescript
// Parent Page
@State() count = 0;

render() {
    return html`
        ${component(CounterDisplay, { count: this.count })}
    `;
}
```

### Passing Actions (Child to Parent)

Events flow up via callbacks passed as properties.

```typescript
// Parent Page
@Server()
async saveData(data: any) {
    // ... save to DB ...
}

render() {
    return html`
        ${component(MyForm, { 
            onSave: (data) => this.saveData(data) 
        })}
    `;
}
```

## Server Actions in Components

Reusable components **do not** automatically connect to the server via `@Server` methods because they are not bootstrapped by the router.

To perform server actions from a reusable component, you should either:

1.  **Pass the action as a prop**: Define the `@Server` method in the parent Page and pass it down (as shown above). This is the recommended pattern for "dumb" UI components.
2.  **Use standard Fetch**: Call an API route (`/api/...`) using `fetch()`. This is useful for self-contained widgets.

```typescript
// Self-contained component using fetch
export class WeatherWidget extends Cossack {
    @ClientState() weather: string = 'Loading...';

    onMount() {
        fetch('/api/weather').then(res => res.text()).then(data => this.weather = data);
    }

    render() {
        return html`<div>${this.weather}</div>`;
    }
}
```
