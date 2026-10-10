---
title: "Advanced Forms Handling"
description: "Build forms with nested fields, arrays, and validation rules in Cossack."
---

# Advanced Forms Handling

## Headless typed form state

For a standalone client-side form, use `createFormController()` with an
`InputSchema`. The controller owns raw field values, typed dot-path updates,
field errors, touched state, validation, reset, and single-submit behavior. The
schema converts raw strings into the types your submit handler receives. This
API has no DOM dependency, so a page or UI package can connect its own labels,
inputs, and error announcements.

```typescript
import { createFormController, input, type InputOf } from '@cossackframework/core';

const profileSchema = input.object({
  name: input.string({ required: true }),
  address: input.object({
    city: input.string({ required: true }),
    age: input.number({ coerce: true, min: 18 }),
  }),
  enabled: input.boolean({ coerce: true }),
  attachment: input.file().optional(),
  attachments: input.array(input.file()),
  tags: input.array(input.string()),
  items: input.array(input.object({ name: input.string({ required: true }) })),
});

const profileForm = createFormController(profileSchema, {
  name: 'Ada',
  address: { city: 'London', age: '17' },
  enabled: 'on',
  attachment: undefined, attachments: [], tags: [], items: [{ name: 'One' }],
});

profileForm.markTouched('address.age');
const checked = await profileForm.validate();

if (!checked.valid) {
  showError('address.age', profileForm.fieldError('address.age'));
}

profileForm.setFieldValue('address.age', '42');
const result = await profileForm.submit(async data => saveProfile(data));
if (result.status === 'submitted') console.log('Profile saved.');

// Keep a successful submission's edited values, or restore the initial values.
profileForm.reset();

function saveProfile(data: InputOf<typeof profileSchema>) {
  console.log(data);
}

function showError(field: string, message: string | undefined) {
  console.error(field, message);
}
```

`validate()` returns parsed data only when valid. A later edit cancels an
in-flight validation and ignores its stale result. `submit()` prevents a second
concurrent submit and copies field errors from Cossack validation failures. If
the values change while the submit handler is pending, the result is reported
as `stale`; the handler's external effects may already have completed.
Call `setFieldError()` or `setFormError()` for other server responses. The
controller does not render markup. Use `createFormBindings()` to connect native
controls, labels, errors and keyboard submission. Array values work as whole
fields or indexed paths such as `items.0.name`. Indices must be nonnegative
integers; writes may edit an existing item or append at the array length, without
creating sparse gaps. File and Blob identities survive local reads and resets.

### Accessible native controls

Create bindings once for the form owner. Supply a stable, unique HTML id. Subscribe
the component to controller updates and dispose both subscriptions when it leaves.
The controller stays independent of the DOM; only the binding adapter handles
browser controls and focus.

```typescript
import { createFormBindings } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const fields = createFormBindings(profileForm, { id: 'profile' });
const unsubscribe = profileForm.subscribe(() => { void owner.requestUpdate(); });

function renderProfile() {
  const name = fields.field('name', { descriptionId: 'profile-name-help' });
  return html`
    <form ...=${fields.form(data => saveProfile(data))}>
      <label ...=${name.label}>Name</label>
      <input ref=${name.ref} ...=${name.input} />
      <p id="profile-name-help">Use your preferred name.</p>
      <p ...=${name.error}>${name.errorMessage ?? ''}</p>
      <p id=${fields.summary.id} role="alert" tabindex="-1">${fields.summary.message ?? ''}</p>
      <button type="submit">Save</button>
      <button type="reset">Reset</button>
    </form>
  `;
}

// In the owner's disposal hook:
unsubscribe();
fields.dispose();
```

Field bindings expose raw `value`, `touched` and `dirty` state. `input` owns the
native value/change/blur handlers and ARIA attributes. `label` and `error` provide
matching label and error ids. The error id joins the existing `descriptionId` in
`aria-describedby` only when that field has an error. `id` and `name` options
preserve authored control identities. Default names use bracket notation, so
`items.0.name` becomes `items[0][name]` in native FormData.

`fields.form(handler)` prevents a page reload and validates through the shared
schema. Native Enter submission and submit buttons use the same handler. Invalid
submission focuses the first enabled control with a field error, in DOM order.
A form-only error focuses the rendered summary. Pass `{ focusInvalid: false }` to
manage focus yourself, and `onResult` to receive the controller's submission
status. The form's `aria-busy` follows submission state when its owner rerenders.
Concurrent submissions return `busy`; stale results do not overwrite later edits.

Choose a binding kind for non-text controls:

```typescript
fields.field('enabled', { kind: 'checkbox' });
fields.field('attachment', { kind: 'file' });
fields.field('attachments', { kind: 'files' });
fields.field('tags', { kind: 'select-multiple' });
```

Checkboxes store booleans. File bindings read actual File objects from the input,
never assign a filename to it, and clear an owned control when its controller
resets to an empty value. Use `ref=${field.ref}` to establish ownership before the
first interaction, especially for a multiple-select control; otherwise input,
change and blur events establish ownership. Dispose bindings to release their DOM
references. Browsers cannot restore a selected file from controller initial data;
resetting a native form clears its file picker even if initial data contains a
File. Use empty initial file values for an editable browser form.

Text and number controls provide raw strings; use coercion in a numeric schema
when needed. Sending controller data to a decorated HTTP server method uses the
existing RPC transport: nested files trigger multipart encoding, while field and
form validation errors map back automatically. Native POST submissions can use
bracket names with `getFormData()` instead; controller bindings are optional for
that path. Files require HTTP transport, since WebSocket JSON cannot represent
native file contents.

### UI package adapter

`createUiFormBindings()` from `@cossackframework/ui` shares the same controller and
accessible identities. Its fields provide `inputProps` for `Input` and
`checkboxProps` for `Checkbox`. Render `field.label` and `field.error` alongside
the control. Pass `bindings.form(handler)` as the UI `Form` component's `bindings`
prop. Omit its separate `submit` prop when typed bindings own submission.
Existing native Form behavior remains available without either prop. Explicit
native attributes and `novalidate` overrides remain supported.

This controller is separate from the existing `@Store()`/`@Validate()` page
workflow below. Use that workflow when page reactivity should own the state.

Use `@Store()` when a form has many fields, nested values, arrays, or client-side interactions. It groups the form values in one state object.

## Defining Complex Fields

Instead of defining a separate state for each field, define one state object with all form fields. In Cossack, `@Store()` creates this object.

This example defines a form with nested fields and an array:

```typescript
interface SubmitFormState {
    email: string;
    password: string;
    age: string;
    username: string;
    website: string;
    discountCode: string;
    // Nested object field — exercises deep (multi-level) reactivity.
    address: {
        zip: string;
        country: string;
    };
    // Array field — exercises array mutation reactivity (push/splice/etc.).
    tags: string[];
}
```

Define a `@Store()` state for the form in your page component:

```typescript
export class StoreValidationDemo extends Cossack {
    @Store()
    submitFormStore: SubmitFormState = {
        email: '',
        password: '',
        age: '',
        username: '',
        website: '',
        discountCode: '',
        address: { zip: '', country: '' },
        tags: [],
    };
}
```


## Validation

The [Validation](./validation.md) feature supports `@Store()` and `@State()` fields. Add `@Validate()` and a validation schema to the store:

```typescript
@Store()
@Validate({
    // Type-safe store rules: a NESTED tree that mirrors the store shape.
    // Object fields nest a sub-tree; primitive/array fields take a rule.
    // The decorator flattens relative keys to full runtime paths
    // ('submitFormStore.email', 'submitFormStore.address.zip', ...).
    // A typo like `emial: { ... }` would fail to compile.
    rules: storeRules<SubmitFormState>({
        email: { required: true, email: true, message: 'Please enter a valid email address' },
        password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        age: { required: true, min: 18, max: 120, message: 'Please enter a valid age (18-120)' },
        username: { required: true, pattern: /^[a-zA-Z0-9_]+$/, message: 'Username can only contain letters, numbers, and underscores' },
        website: { url: true, message: 'Please enter a valid URL' },
        discountCode: {
            required: false,
            customAsync: async (value: string, component: any) => {
                // Skip validation if empty (not required). Demonstrates that
                // customAsync resolves the nested value correctly.
                if (!value || value.trim() === '') return true;
                try {
                    return await component.validateDiscountCode(value);
                } catch (e) {
                    console.error('Validation error:', e);
                    return false;
                }
            },
            message: 'Invalid discount code',
        },
        // Nested object — rules mirror the field shape (relative: 'address.zip').
        address: {
            zip: {
                required: true,
                pattern: /^\d{4,10}$/,
                message: 'Please enter a valid ZIP code (4-10 digits)',
            },
            country: {
                required: true,
                minLength: 2,
                message: 'Please enter your country',
            },
        },
        // Array field — validated as a whole (arrays are addressable by key).
        tags: {
            required: true,
            minLength: 1,
            message: 'Add at least one tag',
        },
    }),
    config: { trigger: 'all', runOn: 'both' },
})
submitFormStore: SubmitFormState = {
    email: '',
    password: '',
    age: '',
    username: '',
    website: '',
    discountCode: '',
    address: { zip: '', country: '' },
    tags: [],
};

// Server-side validation method for discount codes
@Server()
async validateDiscountCode(code: string): Promise<boolean> {
    // Simulate server-side validation (e.g., database lookup).
    await new Promise(resolve => setTimeout(resolve, 100));
    const validCodes = ['SAVE10', 'SAVE20', 'WELCOME', 'VIP50', 'FREESHIP'];
    return validCodes.includes(code.toUpperCase());
}
```


## Form and Field Templates

Now define your own form in the `render()` method with `@submit` event handler that point to the `@Server()` handler method. Since the `@submit` event is a native event which causes the page reload, we have a helper function `preventDefault()` to prevent the default behavior and call the handler method instead.
Otherwise, you can still call `@submit=${e => { e.preventDefault(); this.handleSubmit(); }` but the helper function is more convenient.

```ts
@Server()
async handleSubmit() {
    console.log('Form submitted:', this.submitFormStore);
}

render() {
    return html`
        <form @submit=${preventDefault(this.handleSubmit)}>
            ...
        </form>
    `;
}
```

Then, each field can be defined like so:

```html
<div class="mb-4">
    <label for="email" class="block mb-2">Email (required, email)</label>
    <input
        type="email"
        id="email"
        .value="${this.submitFormStore.email}"
        @input="${(e: Event) => this.handleInput('email', e)}"
        @blur="${(e: Event) => this.handleBlur('submitFormStore.email', e)}"
        class="w-full p-2 border rounded ${this.hasError('submitFormStore.email') ? 'border-red-500' : 'border-gray-300'}"
    />
    ${this.hasError('submitFormStore.email') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.email')}</span>` : ''}
</div>
```

As you can see, we listen to the `@input` event to update the store value and the `@blur` event to trigger validation on every field, so we can avoid repetitive code by creating a helper methods `handleInput()` and `handleBlur()` to handle the events for all fields. Those methods are defined in the page component like so:

```ts
@Client()
handleInput(field: string, event: Event) {
    const target = event.target as HTMLInputElement;
    // Direct nested assignment — the store Proxy makes this reactive.
    (this.submitFormStore as any)[field] = target.value;
    this.validateProperty(`submitFormStore.${field}`, 'input');
}

@Client()
handleBlur(path: string, _event: Event) {
    this.validateProperty(path, 'blur');
}
```

## Put it all together

Here is our complete page component with the form, validation, and submission handling: https://github.com/cossackframework/cossack/blob/master/packages/framework/src/pages/store-validation/index.ts
