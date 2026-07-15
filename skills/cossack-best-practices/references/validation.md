# Form Validation (`@Validate`)

`@Validate` is Cossack's built-in form validation. It runs on **both client and server**, integrates with `@State` / `@ClientState`, and exposes helpers to read errors and run validation programmatically. **Do not write custom validation logic** — use this.

## Basic usage

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

Key points:
- `@Validate()` **must stack on top of** `@State()`, `@ClientState()`, `@Store()`, or `@ClientStore()`. It is not standalone.
- You **must declare** an `errors` state property yourself (default `errorProperty: 'errors'`) — the framework writes messages there, but does not create the property for you. If you omit it, errors are silently swallowed.
- Read errors via `getError()` / `hasError()` in `render()`.

## Validation rules

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
| `coerce` | `'number' \| 'boolean' \| 'date'` | Transform the value **before** other rules run (see below) |
| `message` | `string` | Custom error message (applies to first failing rule) |

## Coercion (the `coerce` rule)

Form submissions arrive as strings (FormData values are always strings). The
`coerce` rule transforms the value before other checks run, and writes the
transformed value back into the returned `data` for `getFormData` /
`validateObject`.

| Mode | Result | Failure |
| :--- | :--- | :--- |
| `'number'` | `Number(value)` | `NaN` (e.g. `"abc"`) |
| `'boolean'` | `"true"` / `"1"` / `"on"` / `"yes"` (case-insensitive) → `true`, else `false` | never |
| `'date'` | `new Date(value)` | `Invalid Date` (e.g. `"xyz"`) |

Two important behaviors:

- Coercion runs **after** the `required` check. Empty values (`null`,
  `undefined`, `''`) are never coerced — `""` stays `""`.
- A coercion that cannot succeed is a **validation failure** (`Number("abc")`
  → `NaN`, `new Date("xyz")` → Invalid Date both fail, and the original value
  is retained in `data`).
- On the reactive `@Validate` path, the coerced value is used for validation
  checks but is **not** written back to your store. Coercion's write-back only
  happens in the `getFormData` / `validateObject` pipeline.

## `getFormData<T>()` — typed return with coercion

`getFormData<T>()` returns `{ data, errors, valid }`. Pass a type parameter and
`coerce` rules so the returned `data` is correctly typed (`number`, `boolean`,
`Date` instead of `string`):

```typescript
interface SignupForm { age: number; tos: boolean; birthday: Date }

const { data, errors, valid } = await this.c.getFormData<SignupForm>({
    rules: storeRules<SignupForm>({
        age:      { coerce: 'number', min: 18, message: 'Must be 18+' },
        tos:      { coerce: 'boolean', required: true, message: 'You must accept the terms' },
        birthday: { coerce: 'date', message: 'Enter a valid date' },
    }),
});

if (valid) {
    data.age;       // number  (e.g. 25, not "25")
    data.tos;       // boolean
    data.birthday;  // Date
}
```

## Validation config

```typescript
@Validate({
    rules: { required: true },
    config: {
        trigger: 'all',          // 'input' | 'blur' | 'submit' | 'all'
        runOn: 'both',           // 'client' | 'server' | 'both'
        errorProperty: 'errors', // where error messages are stored
        debounce: 0              // debounce in ms
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

### `this.validateProperty(name)`
Validates a single property. Returns a `Promise<boolean>` (`true` if valid).
```typescript
await this.validateProperty('email')
```

### `this.validateAll()`
Validates all properties with rules. Returns a `Promise<boolean>` (`true` if all valid). Call this before submit.
```typescript
const isValid = await this.validateAll();
if (isValid) { /* submit */ }
```

### `this.clearErrors()`
Clears all validation errors.

## Async validation (e.g. unique username)

`customAsync` can call `@Server()` methods via proxy — useful for DB lookups. The validator receives the component instance as its second argument.

```typescript
@State()
@Validate({
    rules: {
        required: true,
        customAsync: async (value: string, component: any) => {
            if (!value) return true;
            return await component.checkUsernameAvailable(value);
        },
        message: 'Username is already taken'
    }
})
username: string = '';

@Server()
async checkUsernameAvailable(username: string): Promise<boolean> {
    const existing = await db.query('SELECT ... WHERE username = ?', [username]);
    return existing.length === 0;
}
```

## Complete form example

```typescript
import { html } from '@cossackframework/renderer';
import { Cossack, Page, State, Validate, Client } from '@cossackframework/core';

@Page({ transport: 'http' })
export class RegistrationForm extends Cossack {
    @State()
    @Validate({ rules: { required: true, email: true, message: 'Please enter a valid email' } })
    email: string = '';

    @State()
    @Validate({ rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' } })
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
    handleBlur(field: string) {
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

## Validating a `@Store` (nested objects & arrays)

When `@Validate` is stacked on `@Store` / `@ClientStore`, `rules` is a **map** whose keys are paths relative to the store property. The framework auto-prefixes them at runtime — you write `'email'`, not `'form.email'`. Deep paths use dot notation (`'address.zip'`), and array fields are addressable by key (`'tags'`).

For compile-time-checked keys, wrap the map in `storeRules<T>()` — a typo like `emial` then fails to compile.

```typescript
import { Cossack, Page, Store, Validate, Client, storeRules } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface FormState {
    email: string;
    address: { zip: string; country: string };
    tags: string[];
}

@Page({ transport: 'http' })
export class StoreFormDemo extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<FormState>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            address: {
                zip: { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' },
                country: { required: true, minLength: 2, message: 'Enter your country' },
            },
            tags: { required: true, minLength: 1, message: 'Add at least one tag' },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    form: FormState = { email: '', address: { zip: '', country: '' }, tags: [] };

    // errors must be declared — @Store works here too for nested error maps.
    @Store() errors: Record<string, string> = {};

    @Client()
    handleInput(path: string, event: Event) {
        // Deep assignment is reactive — @Store wraps the value in a Proxy.
        const parts = path.split('.');
        let target: any = this.form;
        for (const p of parts.slice(0, -1)) target = target[p];
        target[parts[parts.length - 1]] = (event.target as HTMLInputElement).value;
        this.validateProperty(`form.${path}`, 'input');
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        const isValid = await this.validateAll(); // validates every registered path
        if (isValid) { /* submit */ }
    }

    render() {
        return html`
            <input .value="${this.form.email}"
                   @input="${(e: Event) => this.handleInput('email', e)}"
                   @blur="${(e: Event) => this.validateProperty('form.email', 'blur')}" />
            ${this.hasError('form.email') ? html`<span>${this.getError('form.email')}</span>` : ''}
        `;
    }
}
```

Notes:
- `validateProperty` / `hasError` / `getError` take the **full** runtime path (`'form.email'`, `'form.address.zip'`) — the prefix is the store property name.
- `errors` is a **single flat object keyed by the full prefixed dot-path** — there is no nesting in `errors` itself. `'form.address.zip'` is a single top-level key. You can freely mix `@Store` with `@State` / `@ClientState` on the same component.
- For nested objects, `storeRules<T>()` accepts a nested rule tree that mirrors the store shape: `address: { zip: { ... } }` is equivalent to the flat dot-path `'address.zip'`. Keys are **relative** to the store and auto-prefixed with the property name at registration time.
- `@Store` makes nested mutations (`this.form.address.zip = ...`, `this.form.tags.push(...)`) reactive without reassigning the whole object. See `references/decorators.md` for the `@Store` / `@ClientStore` API.
