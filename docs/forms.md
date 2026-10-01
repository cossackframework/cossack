---
title: "Forms Handling"
description: "Create forms, handle submissions, and show validation errors in Cossack."
---

# Forms Handling

You can use standard HTML forms in a Cossack page. Cossack can handle form submissions and validation on the server.

## Defining a Form

Add a `<form>` element to your page component:

```typescript
render() {
    return html`
        <form method="post">
            <input type="text" name="username" placeholder="Username" required />
            <input type="email" name="email" placeholder="Email" required />
            <button type="submit">Submit</button>
        </form>
    `;
}
```

This form has two fields and a submit button. The `method="post"` attribute sends the form with the POST method. You can also use GET.

## The `Form` component

The optional Cossack UI `Form` component wraps an HTML `<form>`. It prevents the default submit and adds `novalidate` when you pass a `@Server()` method. It does not store field values or validate them. Use `bind()`, `@State`, or `@Store` for values. Use `@Validate`, `hasError`, or `getError` for validation.

```typescript
import { Cossack, Page, Server, State, Store } from '@cossackframework/core';
import { html, bind, component } from '@cossackframework/renderer';
import { Button, Form, Input } from '@cossackframework/ui';

interface Address { street: string; city: string }

@Page({ transport: 'http' })
export default class ContactForm extends Cossack {
  @State() name = 'Guest';
  @Store() address: Address = { street: '', city: '' };

  @Server()
  handleSubmit() {
    console.log(`Submitted: ${this.name}, ${this.address.street}`);   // reads from state
  }

  render() {
    // Passing `submit` makes Form prevent the native submit + add `novalidate`.
    // bind() two-way binds an input to state — works inside component() props
    // and supports nested dot-paths (e.g. 'address.street').
    return component(Form, { submit: this.handleSubmit },
      html`
        ${component(Input, { name: 'name', '.value': bind(this, 'name') })}
        ${component(Input, { name: 'street', '.value': bind(this, 'address.street') })}
        ${component(Button, { type: 'submit' }, 'Submit')}
      `,
    );
  }
}
```

> **`bind()` works with `component()` props.** Pass the directive as a `.value` (or `.checked`) prop: `component(Input, { '.value': bind(this, 'name') })`. It also supports nested state via dot-paths : `bind(this, 'address.street')` reads/writes the nested field, triggering `@Store` reactivity. The equivalent direct form `<input .value="${bind(this, 'name')}" />` works too.

| Prop | Description |
|---|---|
| `submit` | Submit handler (typically a `@Server()` method). When set, the native submit is prevented and `novalidate` is added by default. Omit for a native `<form method="post">` submission (read with `getFormData()`). |
| `novalidate` | Override the `novalidate` default. Defaults to `true` when `submit` is set, `false` otherwise. |
| `...rest` | Any other props (`method`, `action`, `class`, …) spread onto the native `<form>`. |

This is sugar over the equivalent bare form:

```typescript
// Same behavior, written by hand:
<form @submit="${preventDefault(this.handleSubmit)}" novalidate>...</form>
```

For the native POST + `getFormData()` pattern, just omit `submit`:

```typescript
component(Form, { method: 'post' }, html`<input name="email" /> ...`)
```

## Handling Form Submission

To handle a form submission, define a method for its HTTP method in the page component. For a POST request, define a `post()` method. See [API Routes](/docs/api-routes.md).

```typescript
post() {
    const formData = this.c.req.formData();
    const username = formData.get('username');
    const email = formData.get('email');

    // Process the form data (e.g., save to database, send email, etc.)
    console.log(`Username: ${username}, Email: ${email}`);

    // Redirect back to the form after processing
    return this.back();
}
```

## Flashing Messages

In most cases, you will want to let the user know that their form submission was successful or if there were any errors. You can use the `flash()` method to set a flash message that will be displayed on the next page load.

```typescript
// Inside your post() method after processing the form data
flash('success', 'Form submitted successfully!');
// or
flash('errors', 'There was an error submitting the form. Please try again.');
```

Now display the flash message in your page component by reading it back with `flashed()` and checking for it in the `render()` method.

Since the `render()` method is a shared method, which is also used in the client, and we need to get the flash message from the server, we need to retrieve them in the `init()` method using `flashed()`. We also need to define states for them.

```typescript
// NestedErrors<T> is derived from your form type T, so you never have to spell
// out the errors shape by hand. See the Server-Side Validation section below.
@State()
success: string | null = null;

@State()
errors: NestedErrors<{ name: string; email: string }> | null = null;

init() {
    this.success = flashed('success');
    this.errors = flashed('errors');
}

render() {
    return html`
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}
        <form method="post">...</form>
    `;
}
```

See [Session & Flash](/docs/session.md) for the full flash/old-input API and how the signed-cookie transport works.

## Server-Side Validation

You can validate form data server-side using `this.c.getFormData()` with `storeRules<T>()`. When the form is invalid, the submitted input **and** the validation errors are flashed to the next request automatically : you no longer have to call `flashInput()` or `flash('errors', ...)` yourself. Just redirect back.

> **Tip:** `FormData` values are always strings. Add a `coerce` rule to produce typed `data` : e.g. `age: { coerce: 'number', min: 18 }` turns `"25"` into `25`. See [Validation → Coercion](/docs/validation.md#coercion).

```typescript
post() {
    const { data, valid } = await this.c.getFormData<ContactFormShape>({
      rules: storeRules<ContactFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required and must be valid' },
      }),
      // `flash` defaults to true: the submitted input is flashed for `old()`
      // repopulation, and the errors are flashed when the form is invalid.
    });

    if (!valid) {
        // errors + old input were auto-flashed above — just redirect back.
        return this.back();
    }

    // Process the valid form data (e.g., save to database, send email, etc.)
    // ...

    flash('success', 'Form submitted successfully!');
    return this.back();
}
```

Now you can display the validation errors in your form. Because the flashed `errors` object mirrors your form type, both direct access (`this.errors?.name`) and the `hasError()` / `getError()` helpers work : including for nested fields via dot-paths:

```typescript
render() {
    return html`
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}
        <form method="post">
            <input type="text" name="name" placeholder="Name" required />
            ${this.hasError('name') ? html`<p style="color: red;">${this.getError('name')}</p>` : ''}
            <input type="email" name="email" placeholder="Email" required />
            ${this.hasError('email') ? html`<p style="color: red;">${this.getError('email')}</p>` : ''}
            <button type="submit">Submit</button>
        </form>
    `;
}
```

### Auto-flash in detail

`getFormData()` accepts a `flash` option that controls this behavior (default `true`):

| `flash` value        | Flashed input (`old`) | Flashed errors           |
|----------------------|------------------------|---------------------------|
| omitted / `true`     | ✅                     | ✅ (only when non-empty)  |
| `false`              | ❌                     | ❌                         |
| `{ input: false }`   | ❌                     | ✅                         |
| `{ errors: false }`  | ✅                     | ❌                         |

Errors are only flashed when there actually are any : a valid form never flashes an empty `errors` object, so truthy checks like `${this.errors ? ...}` will not render an error banner on success. The submitted input is always flashed when input-flashing is on (single-use, harmlessly dropped if not read). Signed flash cookies preserve UTF-8 text, including accented names, non-Latin scripts, and emoji. Flashing is a no-op when no flash store is wired (e.g. on the client), so opting out is as simple as `{ flash: false }`.

## Put it All Together

Now you have a complete overview of how to create and handle forms in Cossack in traditional ways. Here is a complete example of a form component that handles form submission, validation, flashing messages, and old input repopulation.

```typescript
import {
  Cossack,
  Page,
  storeRules,
  flash,
  State,
  type NestedErrors,
} from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface ContactFormFields {
    name: string;
    email: string;
}

export default class ContactForm extends Cossack {
  // `flash` / `old` options auto-bind flashed values and old input during
  // bootstrap, so there's no init() boilerplate. The flashed value wins over
  // the initializer; otherwise the initializer is kept.
  @State({ flash: true })
  success: string | undefined;

  // NestedErrors<ContactFormFields> mirrors the form type, so optional-chaining
  // (this.errors?.name) is fully typed without spelling out the shape.
  @State({ flash: true })
  errors: NestedErrors<ContactFormFields> | undefined;

  @State({ old: true })
  name: string = '';

  @State({ old: true })
  email: string = '';

  async post() {
    // getFormData() auto-flashes the submitted input (for old()) and the
    // errors (when invalid) — no manual flashInput()/flash('errors') needed.
    const { data, valid } = await this.c.getFormData<ContactFormFields>({
      rules: storeRules<ContactFormFields>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required' },
      }),
    });

    if (!valid) {
      return this.back();   // errors + old input already auto-flashed
    }

    console.log('Validated form data:', data.name, data.email);
    flash('success', 'Form submitted successfully!');
    return this.c.redirect('/forms');
  }

  render() {
    return html`
      <div>
        <h1>Contact Form</h1>
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}

        <form method="post" novalidate>
          <div>
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" value="${this.name ?? ''}" />
            ${this.hasError('name') ? html`<span style="color: red;">${this.getError('name')}</span>` : ''}
          </div>

          <div>
            <label for="email">Email:</label>
            <input type="email" id="email" name="email" value="${this.email ?? ''}" />
            ${this.hasError('email') ? html`<span style="color: red;">${this.getError('email')}</span>` : ''}
          </div>

          <button type="submit">Submit</button>
        </form>
      </div>
    `;
  }
}
```

> **Need to transform a value?** The `flash` / `old` options cover the common case (bind a value as-is). Keep an `init()` method when you need to *compute or merge* values : e.g. combining several flashed fields or defaulting from config. The manual `flashed()` / `old()` helpers still work alongside the options. See [Session & Flash → Auto-binding](/docs/session.md#auto-binding-flash--old-input-into-state).

## Complex Form

For a form with nested fields or arrays, use square bracket notation as in PHP. Cossack supports this notation for form fields and validation.

`hasError()` and `getError()` accept dot-paths, so nested fields like `address.city` work the same way as top-level fields : no manual optional-chaining into the `errors` object required.

```typescript
// Example of a complex form with nested fields and arrays
interface ComplexFormShape {
    name: string;
    email: string;
    address: {
        street: string;
        city: string;
    };
}

async post() {
    const { data, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required and must be valid' },
        address: {
          street: { required: true, message: 'Street is required' },
          city: { required: true, message: 'City is required' },
        },
      }),
    });

    if (!valid) {
        return this.back();   // errors + old input auto-flashed
    }
    // ...process data...
    flash('success', 'Form submitted successfully!');
    return this.c.redirect('/forms');
}

render() {
    return html`
      <form method="post" novalidate>
        <input type="text" name="name" placeholder="Name" value="${this.name ?? ''}" />
        ${this.hasError('name') ? html`<span style="color: red;">${this.getError('name')}</span>` : ''}

        <input type="email" name="email" placeholder="Email" value="${this.email ?? ''}" />
        ${this.hasError('email') ? html`<span style="color: red;">${this.getError('email')}</span>` : ''}

        <input type="text" name="address[street]" placeholder="Street" value="${this.address?.street ?? ''}" />
        ${this.hasError('address.street') ? html`<span style="color: red;">${this.getError('address.street')}</span>` : ''}

        <input type="text" name="address[city]" placeholder="City" value="${this.address?.city ?? ''}" />
        ${this.hasError('address.city') ? html`<span style="color: red;">${this.getError('address.city')}</span>` : ''}

        <button type="submit">Submit</button>
      </form>
    `;
}
```
