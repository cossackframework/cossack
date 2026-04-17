# Form Validation

The `@Validate` decorator provides form validation that runs on both client and server. It integrates seamlessly with `@State` and `@ClientState` decorators.

## Usage

```typescript
import { Cossack, Page, State, Validate } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class LoginForm extends Cossack {
    @State()
    @Validate({
        rules: { required: true, email: true, message: 'Please enter a valid email' }
    })
    email: string = '';

    @State()
    @Validate({
        rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }
    })
    password: string = '';

    @State()
    errors: Record<string, string> = {};

    render() {
        return html`
            <input .value="${this.email}" @input="${e => this.email = e.target.value}" />
            ${this.hasError('email') ? html`<span>${this.getError('email')}</span>` : ''}
        `;
    }
}
```

## Validation Rules

| Rule | Type | Description |
| :--- | :--- | :--- |
| `required` | `boolean` | Field cannot be empty |
| `minLength` | `number` | Minimum string/array length |
| `maxLength` | `number` | Maximum string/array length |
| `min` | `number` | Minimum numeric value |
| `max` | `number` | Maximum numeric value |
| `pattern` | `RegExp` | Must match regex pattern |
| `email` | `boolean` | Must be valid email format |
| `url` | `boolean` | Must be valid URL (http/https) |
| `custom` | `(value: any) => boolean` | Custom synchronous validator |
| `customAsync` | `(value: any, component?: any) => Promise<boolean>` | Custom async validator |
| `message` | `string` | Custom error message |

## Validation Config

```typescript
@Validate({
    rules: { required: true },
    config: {
        trigger: 'all',      // 'input' | 'blur' | 'submit' | 'all'
        runOn: 'both',       // 'client' | 'server' | 'both'
        errorProperty: 'errors',  // Property name to store errors
        debounce: 0          // Debounce in ms
    }
})
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `trigger` | `'input' \| 'blur' \| 'submit' \| 'all'` | `'all'` | When to run validation |
| `runOn` | `'client' \| 'server' \| 'both'` | `'both'` | Where validation runs |
| `errorProperty` | `string` | `'errors'` | Property name to store error messages |
| `debounce` | `number` | `0` | Debounce time in milliseconds |

## Component API

### `this.getError(propertyName)`

Returns the error message for a property, or `undefined` if valid.

```typescript
this.getError('email') // => 'Please enter a valid email' | undefined
```

### `this.hasError(propertyName)`

Returns `true` if the property has validation errors.

```typescript
this.hasError('email') // => true | false
```

### `this.validateProperty(name)`

Validates a single property. Returns a Promise that resolves to `true` if valid.

```typescript
await this.validateProperty('email')
```

### `this.validateAll()`

Validates all properties with validation rules. Returns a Promise that resolves to `true` if all are valid.

```typescript
const isValid = await this.validateAll();
if (isValid) {
    // Submit form
}
```

### `this.clearErrors()`

Clears all validation errors.

```typescript
this.clearErrors();
```

## Async Validation with Server Methods

The `customAsync` rule allows async validation that can call `@Server()` methods via proxy. This is useful for checking unique values in a database.

```typescript
@State()
@Validate({
    rules: {
        required: true,
        customAsync: async (value: string, component: any) => {
            // component gives access to @Server() methods
            if (!value) return true;
            return await component.checkUsernameAvailable(value);
        },
        message: 'Username is already taken'
    }
})
username: string = '';

// Server method - runs on server, can access database
@Server()
async checkUsernameAvailable(username: string): Promise<boolean> {
    const existing = await db.query('SELECT ... WHERE username = ?', [username]);
    return existing.length === 0;
}
```

Note: The `customAsync` function receives a `component` parameter that gives you access to the component instance and its `@Server()` methods.

## Complete Example

```typescript
import { html } from '@cossackframework/renderer';
import { Cossack, Page, State, Validate, Client } from '@cossackframework/core';

@Page({ transport: 'http' })
export class RegistrationForm extends Cossack {
    @State()
    @Validate({
        rules: { required: true, email: true, message: 'Please enter a valid email' }
    })
    email: string = '';

    @State()
    @Validate({
        rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' }
    })
    password: string = '';

    @State()
    errors: Record<string, string> = {};

    @State()
    submitted: boolean = false;

    @Client()
    handleInput(field: string, event: Event) {
        const target = event.target as HTMLInputElement;
        this.setProperty(field, target.value);
        this.validateProperty(field);
    }

    @Client()
    handleBlur(field: string, event: Event) {
        this.validateProperty(field);
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        const isValid = await this.validateAll();
        if (isValid) {
            this.submitted = true;
            this.requestUpdate();
        }
    }

    render() {
        return html`
            <form @submit="${(e: Event) => this.handleSubmit(e)}">
                <div>
                    <input
                        .value="${this.email}"
                        @input="${(e: Event) => this.handleInput('email', e)}"
                        @blur="${(e: Event) => this.handleBlur('email', e)}"
                    />
                    ${this.hasError('email') ? html`<span>${this.getError('email')}</span>` : ''}
                </div>
                <div>
                    <input
                        type="password"
                        .value="${this.password}"
                        @input="${(e: Event) => this.handleInput('password', e)}"
                        @blur="${(e: Event) => this.handleBlur('password', e)}"
                    />
                    ${this.hasError('password') ? html`<span>${this.getError('password')}</span>` : ''}
                </div>
                <button type="submit">Submit</button>
            </form>
            ${this.submitted ? html`<p>Form submitted successfully!</p>` : ''}
        `;
    }
}
```
