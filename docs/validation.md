---
title: "Form Validation"
description: "Form validation using the @Validate decorator that runs on both client and server with seamless @State integration."
---

# Form Validation

The `@Validate` decorator provides form validation that runs on both client and server. It integrates seamlessly with `@State`, `@ClientState`, `@Store`, and `@ClientStore` decorators.

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
| `coerce` | `'number' \| 'boolean' \| 'date'` | Coerce the value before validating (see [Coercion](#coercion)) |
| `message` | `string` | Custom error message |

## Coercion

Form submissions arrive as strings — `FormData` values are always strings, so a field you think of as a number comes through as `"25"`. The `coerce` rule transforms the value before the other checks run, and (for `getFormData` / `validateObject`) writes the transformed value back into the returned `data`, so the runtime type matches your declared form type.

| Mode | Result | Failure |
| :--- | :--- | :--- |
| `'number'` | `Number(value)` | `NaN` (e.g. `"abc"`) |
| `'boolean'` | `"true"` / `"1"` / `"on"` / `"yes"` (case-insensitive) → `true`, else `false` | never |
| `'date'` | `new Date(value)` | `Invalid Date` (e.g. `"xyz"`) |

```typescript
interface SignupForm { age: number; tos: boolean; birthday: Date }

const { data, valid } = await this.c.getFormData<SignupForm>({
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

**Two important behaviors:**

- **Coercion runs after the `required` check.** Empty values (`null`, `undefined`, `''`) are never coerced — `""` stays `""`, it does not become `0` or `false`. This keeps `required` meaningful.
- **A coercion that cannot succeed is a validation failure.** `Number("abc")` produces `NaN`, and `new Date("xyz")` produces an Invalid Date — both fail validation (and the original value is retained in `data`).

> **Note on `@Validate` stores:** the coerced value is used for the validation checks (so `min`/`max`/`custom` run against the typed value), but it is **not** written back to your store — store fields keep whatever value you assigned them. Coercion's write-back only happens in the `getFormData` / `validateObject` pipeline.

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

## Validating Stores

When you group related fields in a single `@Store` (or `@ClientStore`) object, decorate the **store property** with `@Validate` and pass a **nested rule tree** that mirrors the store shape — each field of the store takes a rule, and object fields nest a sub-tree. Use the `storeRules<T>()` helper to get compile-time checking of the field paths against the store type, so typos like `emial` fail to compile.

### Type-safe rules with `storeRules<T>()` (recommended)

Pass `storeRules<T>(...)` as the `rules`. The tree mirrors `T`: primitive fields (and arrays, `Date`, `RegExp`, etc.) take a `ValidationRule` directly, while object fields nest a sub-tree. The keys you write are **relative** to the store and are auto-prefixed with the decorated property name at registration time, so the runtime paths become `form.email`, `form.address.zip`, etc. `<T>` is optional — omit it for an untyped map.

```typescript
import { Cossack, Page, Store, Validate, Client, storeRules } from '@cossackframework/core';

interface FormState {
    email: string;
    password: string;
    address: { zip: string };
    tags: string[];
}

@Page({ transport: 'http' })
export class StoreFormDemo extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<FormState>({
            email: { required: true, email: true, message: 'Please enter a valid email' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
            // Nested object — rules mirror the field shape (relative: 'address.zip').
            address: { zip: { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' } },
            // Array field — validated as a whole (minLength/required).
            tags: { required: true, minLength: 1, message: 'Add at least one tag' },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    form: FormState = { email: '', password: '', address: { zip: '' }, tags: [] };

    @Store() errors: Record<string, string> = {};

    @Client()
    handleInput(field: string, event: Event) {
        // Mutate the store directly (nested assignment is reactive via the Proxy).
        (this.form as any)[field] = (event.target as HTMLInputElement).value;
        // Validate the field by its full runtime path.
        this.validateProperty(`form.${field}`, 'input');
    }
}
```

A typo in a key is caught at compile time:

```typescript
// ❌ Type error: 'emial' is not assignable to keyof FormState
rules: storeRules<FormState>({ emial: { required: true } })
```

### Addressing fields at runtime
At runtime, `validateProperty`, `hasError`, and `getError` always take the **full prefixed dot-path** (the store name + the dotted path to the leaf you wrote). The framework flattens the rule tree to these paths and resolves each on the component instance (walking into the store), so it works at any depth.

```typescript
await this.validateProperty('form.address.zip', 'input');
this.hasError('form.address.zip');   // => true | false
this.getError('form.address.zip');   // => 'Invalid ZIP' | undefined
```

### How errors are stored
The `errors` object (the `errorProperty`, default `'errors'`) remains a **single flat object keyed by the full prefixed dot-path**. There is no nesting in `errors` itself — `'form.address.zip'` is a single top-level key. `validateAll()` validates every registered leaf (including nested ones) and `clearErrors()` clears them all in one call.

### Mixing stores and individual states
You can freely mix `@Store` with `@State`/`@ClientState` on the same component. A `@Validate` on a store property produces dot-path rules; a `@Validate` on a `@State` property produces a single-rule entry keyed by the property name. Both coexist in the same `errors` object.

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
