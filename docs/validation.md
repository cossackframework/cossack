---
title: "Form Validation"
description: "Form validation with the @Validate decorator that runs on both client and server and integrates with @State."
---

# Form Validation

The `@Validate` decorator provides form validation that runs on both client and server. It integrates with `@State`, `@ClientState`, `@Store`, and `@ClientStore` decorators.

## Validated server actions

Declare a server contract with `input` from `@cossackframework/core`. Use
`InputOf<typeof contract>` for the method parameter. The server parses incoming
data before calling the method. This applies to component actions, forwarded
services and explicit service RPC, including multipart uploads.

For standalone parsing, import the helpers from `@cossackframework/core/input`.
This entry exports `input`, its types, `parseFormData`, `ActionValidationError`
and `isActionValidationError` without component or runtime imports.
Use `pnpm exec cossack docs --package @cossackframework/core --json` to read
installed examples for schemas, nested forms and validation cancellation.

```typescript
import { input, Server, type InputOf, type RawInputOf } from '@cossackframework/core';

const saveInput = input.object({
    title: input.string({ required: true, minLength: 3, maxLength: 200 }),
    count: input.number({ coerce: true, integer: true, min: 1 }),
    profile: input.object({ email: input.string({ email: true }) }),
    tags: input.array(input.enum(['draft', 'published']), { maxItems: 8 }),
    note: input.string().optional(),
});

type SaveInput = InputOf<typeof saveInput>;
type IncomingSaveInput = RawInputOf<typeof saveInput>;

// Inside a Cossack component or service:
@Server({ input: saveInput })
async save(data: SaveInput) {
    // data.count is a number. No unlisted field reaches this method.
    return { title: data.title, count: data.count };
}
```

Noncoercing schemas keep the same raw and parsed types. String fields accept
strings, enums accept their declared choices, and file arrays accept files.
Optional fields add `undefined`. Nullable fields add `null`. Coercing schemas
explicitly include their supported incoming types.

`InputOf` describes parsed values. `RawInputOf` describes supported incoming
values, so the coercing count accepts a number or string at the boundary.
Authored native method parameters keep the parsed type. Ordinary direct server
calls do not run decorator validation. Normalize client form values before
calling the authored method. Validation metadata is not a wrapper around native
JavaScript calls.

For example, pass `Number(form.count)` and an explicitly parsed boolean to
`this.save(...)`, then handle server field errors if those values are invalid.
`RawInputOf` does not widen a browser proxy or native method's parameter type.
For API handlers and other native entrypoints, explicitly call
`await contract.parse(raw, { signal })` before using the parsed value.
Native entrypoints own their error response mapping as well as parsing.
Keep private server contracts separate from shared browser form rules.

Schemas also apply to public function fields, including arrow functions and async
generator functions, with both `Server` and `createTypedDecorators().Server`:

```typescript
@Server({ input: saveInput })
save = async (data: SaveInput) => ({ title: data.title, count: data.count });
```

The decorator does not change the field's native return type. Private/protected
field inference is not supported. Expose the RPC action as a public member.

Compose input parsing with `@Server({ input: contract, authorize })` for record
access. The authorizer receives parsed values, trusted server context and the
owned action signal. It must return boolean `true` to allow mutation. Use
the resource kit's `policy.action(...)` for a typed record lookup and decision.
See [resource policies](./authorization.md#typed-resource-policies). Neither
input validity nor public permission state establishes ownership. Both direct
and typed-channel Server decorators retain authorizer input inference.

| Builder | Incoming values and behavior |
| :--- | :--- |
| `input.string(rules)` | Strings only. Empty strings are valid unless constrained. `required` also rejects whitespace. Existing length, pattern, email and URL rules apply. |
| `input.number({ coerce, integer, min, max })` | Finite numbers. Explicit coercion also accepts nonempty decimal/scientific strings. Booleans, hex strings and empty strings fail. `integer` requires a safe integer. |
| `input.boolean({ coerce })` | Booleans. Explicit coercion accepts trimmed, case-insensitive `true/1/on/yes` and `false/0/off/no`. Other values fail. |
| `input.literal(value)` / `input.enum(['draft', 'published'])` | Exact literals. Enum choices retain their TypeScript union. |
| `input.date({ coerce })` | Valid Date instances are copied. Explicit coercion accepts canonical UTC ISO strings such as `2026-10-03T00:00:00.000Z`. Dates with offsets, omitted milliseconds or invalid calendar values fail. |
| `input.object(shape)` | Plain objects, with unknown keys rejected at every declared object. `{ unknownKeys: 'strip' }` explicitly removes them at that object only. The parsed object is a new object with no prototype. |
| `input.array(item, { minItems, maxItems })` | Dense arrays. Each item is parsed. Holes, accessor properties and extra array properties fail. Default maximum: 1,024 items. |
| `input.file({ maxBytes, mediaTypes })` | Actual uploaded File instances, with optional byte limit and exact declared media type checks. File-shaped JSON objects fail. The media type is upload metadata, not a content inspection. |

JSON RPC serializes a Date as a string. Use `input.date({ coerce: true })` for
such fields, even when the authored client argument is a Date. Strict
`input.date()` accepts actual Date instances in imperative parsing and rejects
date strings received over JSON.

Fields are required by their type unless marked `.optional()`. That permits
`undefined` and omits absent object fields. `.nullable()` permits `null`. It does
not make a field optional. Typed action contracts accept at most one argument.
A missing argument is parsed as `undefined`. An extra positional argument fails.
Object schemas allow at most 1,024 fields. Parsing limits depth to 32, visited
nodes to 4,096, and reported errors to 128. Cycles and prototype/accessor inputs
are rejected. Parsing does not mutate incoming objects or arrays.

RPC HTTP validation failures return status 400 and `COSSACK_VALIDATION_FAILED`.
Socket calls use the same code in their correlated error frame. Client proxies
expose `RpcError.fieldErrors`, with nested object keys and numeric array indices:

```typescript
// { profile: { email: 'Invalid email address' }, items: { 0: { count: 'Minimum value is 1' } } }
const emailError = error.fieldErrors?.profile;
// Container and form errors use the reserved `_` key.
```

Use `.refine()` for application validation. A `false` result creates a field
error. A thrown/rejected callback or a nonboolean result is an internal failure.
Its private message is not sent to the caller, including when it throws a
`ClientVisibleError`, `ActionValidationError` or HTTP exception. The original
exception remains the internal error's `cause` for server diagnostics. Return
`false` to produce a field error. Use read-only validation here.
Put a mutation in the action after all checks succeed.

```typescript
const nameInput = input.string().refine(async (name, { signal }) => {
    return await isAvailable(name, signal); // Application-supplied lookup.
}, 'That name is already taken.');
```

When a transport request is cancelled, parsing stops owning pending refinements
and no later validator/action starts. Callbacks receive the request signal for
cooperative I/O cancellation. A callback that ignores cancellation can continue
its own work. There is no side-effect rollback. This does not introduce a
server execution deadline for arbitrary application code.

Use a static object literal for the `@Server` configuration. The client compiler removes
`input`, its inline callbacks and private module declarations that become unused.
A local contract that remains reachable from client code or an export fails the
client build. Type-only uses such as `InputOf<typeof saveInput>` do not retain its
runtime code. Imported contract modules must not also supply runtime client
exports. Use separate modules so their private initializers can be removed.
Destructured contracts are removed as one declaration. Client use of a sibling
binding fails the build. Private runtime TypeScript enum/namespace dependencies
fail the build rather than leaving their initializers in client code. Use plain
const/function declarations or a separate contract module.
Keep separate shared `storeRules` maps for client form validation.
The mutation recipe demonstrates this composition. Dynamic option objects and
spreads fail the client build because they can hide server validation code.

Plain rule maps are not action contracts. Pass a schema such as
`@Server({ input: input.object({ count: input.number({ coerce: true }) }) })`.
Declare every accepted key and nested/file shape, and use one input argument.
TypeScript rejects maps. Stale JavaScript metadata fails before validation
callbacks or mutation and logs a migration error on the server. The client gets
a correlated internal failure. Existing form validation, `@Validate` and
`storeRules` continue to accept their rule maps.

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

Form submissions arrive as strings. `FormData` values are always strings, so a field you treat as a number comes through as `"25"`. The `coerce` rule transforms the value before the other rules run. For `getFormData` / `validateObject`, it writes the transformed value back into the returned `data`. The runtime type then matches your declared form type.

| Mode | Result | Failure |
| :--- | :--- | :--- |
| `'number'` | `Number(value)` | `NaN` (for example `"abc"`) |
| `'boolean'` | `"true"` / `"1"` / `"on"` / `"yes"` (case-insensitive) → `true`, else `false` | never |
| `'date'` | `new Date(value)` | `Invalid Date` (for example `"xyz"`) |

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

Coercion runs after the `required` rule. Empty values (`null`, `undefined`, `''`) are never coerced. `""` stays `""` and does not become `0` or `false`. This keeps `required` meaningful.

A coercion that cannot succeed is a validation failure. `Number("abc")` produces `NaN`, and `new Date("xyz")` produces an Invalid Date. Both fail validation, and the original value is retained in `data`.

On `@Validate` stores, the coerced value drives the validation rules, so `min`/`max`/`custom` run against the typed value. The coerced value is not written back to your store. Store fields keep the value you assigned. Coercion writes back only in the `getFormData` / `validateObject` pipeline.

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

The `customAsync` rule allows async validation that can call `@Server()` methods via proxy. This is useful for uniqueness lookups in a database.

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

The `customAsync` function receives a `component` parameter. It gives you access to the component instance and its `@Server()` methods.

## Validating Stores

When you group related fields in a single `@Store` (or `@ClientStore`) object, decorate the store property with `@Validate` and pass a nested rule tree that mirrors the store shape. Each field of the store takes a rule, and object fields nest a sub-tree. Use the `storeRules<T>()` helper for compile-time type checks of the field paths against the store type. Typos like `emial` fail to compile.

### Type-safe rules with `storeRules<T>()` (recommended)

Pass `storeRules<T>(...)` as the `rules`. The tree mirrors `T`. Primitive fields (and arrays, `Date`, `RegExp`, and similar types) take a `ValidationRule` directly, while object fields nest a sub-tree. The keys you write are relative to the store and are auto-prefixed with the decorated property name at registration time, so the runtime paths become `form.email`, `form.address.zip`, and similar. `<T>` is optional. Omit it for an untyped map.

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
At runtime, `validateProperty`, `hasError`, and `getError` always take the full prefixed dot-path (the store name plus the dotted path to the leaf you wrote). The framework flattens the rule tree to these paths and resolves each on the component instance (walking into the store), so it works at any depth.

```typescript
await this.validateProperty('form.address.zip', 'input');
this.hasError('form.address.zip');   // => true | false
this.getError('form.address.zip');   // => 'Invalid ZIP' | undefined
```

### How errors are stored
The `errors` object (the `errorProperty`, default `'errors'`) remains a single flat object keyed by the full prefixed dot-path. There is no nesting in `errors` itself. `'form.address.zip'` is a single top-level key. `validateAll()` validates every registered leaf (including nested ones), and `clearErrors()` clears them all in one call.

### Mixing stores and individual states
Use `@Store` with `@State` or `@ClientState` on the same component. A `@Validate` decorator on a store property creates dot-path rules. On a `@State` property, it creates one rule keyed by the property name. Both rules appear in the same `errors` object.

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
