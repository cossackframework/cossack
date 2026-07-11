---
title: "Forms Handling"
description: "Learn how to create and handle standard forms in Cossack, including validation, submission, and error handling."
---

# Forms Handling

Cossack lets you create and handle forms submissions easily as you would in a traditional web application. Your knowledge of the old days of PHP and HTML still applies here for a good reason.

## Defining a Form

Just like you would in the old days, you can define a form in your page component using the `<form>` HTML element. 

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

That's it! You have defined a form with two input fields and a submit button. The `method="post"` attribute indicates that the form will be submitted using the POST method. Feel free to use GET method as well.

## Handling Form Submission

As defined in the [API Routes](/docs/api-routes.md) section, you can handle form submissions by defining handlers for the HTTP methods in your page component. For example, to handle a POST request when the form is submitted, you can define a `post()` method in your page component.

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
@State()
success: string | null = null;

@State()
errors: {
    name?: string | null;
    email?: string | null;
} | null = null;

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

## Server-Side Validation

The `flash()` method can also be used to flash validation errors back to the form. We might use `this.c.getFormData()` to get the form data and validate it in the `post()` method. 

```typescript
post() {
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required and must be valid' },
      }),
    });

    if (!valid) {
      flash('errors', errors);
      return this.back();
    }

    // Process the valid form data (e.g., save to database, send email, etc.)
    // ...
    
    flash('success', 'Form submitted successfully!');
    return this.back();
}
```

Now you can display the validation errors in your form by checking for the `errors` state in the `render()` method.

```typescript
render() {
    return html`
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}
        <form method="post">
            <input type="text" name="name" placeholder="Name" required />
            ${this.errors?.name ? html`<p style="color: red;">${this.errors.name}</p>` : ''}
            <input type="email" name="email" placeholder="Email" required />
            ${this.errors?.email ? html`<p style="color: red;">${this.errors.email}</p>` : ''}
            <button type="submit">Submit</button>
        </form>
    `;
}
```

## Flashing Old Input

In case of validation errors, you might want to flash the old input back to the form so that the user doesn't have to re-enter all the data. You can use the `flashInput()` method to flash input data back to the form.

```typescript
async post() {
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required and must be valid' },
      }),
    });

    if (!valid) {
      flash('errors', errors);
      flashInput(data); // Flash the old input back to the form
      return this.back();
    }

    // Process the valid form data (e.g., save to database, send email, etc.)
    // ...
    
    flash('success', 'Form submitted successfully!');
    return this.back();
}
```

Remember to retrieve the flashed input in the `init()` method using `old()` and use it in the `render()` method to pre-fill the form fields.

```typescript
@State()
email: string | null = null;

@State()
name: string | null = null;

init() {
    this.success = flashed('success');
    this.errors = flashed('errors');
    this.name = old<string>('name') ?? '';
    this.email = old<string>('email') ?? '';
}

render() {
    return html`
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}
        <form method="post">
            <input type="text" name="name" placeholder="Name" .value=${this.name} required />
            ${this.errors?.name ? html`<p style="color: red;">${this.errors.name}</p>` : ''}
            <input type="email" name="email" placeholder="Email" .value=${this.email} required />
            ${this.errors?.email ? html`<p style="color: red;">${this.errors.email}</p>` : ''}
            <button type="submit">Submit</button>
        </form>
    `;
}
```

## Put it All Together

Now you have a complete overview of how to create and handle forms in Cossack in traditional ways. Here is a complete example of a form component that handles form submission, validation, flashing messages, and old input.

```typescript
import {
  Cossack,
  Page,
  storeRules,
  flash,
  flashed,
  flashInput,
  old,
  State,
} from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface ContactFormFields {
    name: string;
    email: string;
}

export default class ContactForm extends Cossack {
  @State()
  success: string | undefined;

  @State()
  errors: {
    name?: string;
    email?: string;
  } | undefined;

  @State()
  name: string = '';

  @State()
  email: string = '';

  async init() {
    // Read flashed data on the GET that follows the redirect.
    this.success = flashed<string>('success');
    this.errors = flashed('errors');
    this.name = old<string>('name') ?? '';
    this.email = old<string>('email') ?? '';
  }

  async post() {
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, message: 'Email is required' },
      }),
    });

    // Repopulate the submitted values on either branch so the user keeps them.
    flashInput(data as unknown as Record<string, unknown>);

    if (!valid) {
      flash('errors', errors); // nested shape: errors.address.city
      return this.back();      // redirect to Referer (returns the Response)
    }

    console.log('Validated form data:', data.name, data.email);
    flash('success', 'Form submitted successfully!');
    return this.c.redirect('/forms/complex');
  }

  render() {
    return html`
      <div>
        <h1>Complex Form</h1>
        ${this.success ? html`<p style="color: green;">${this.success}</p>` : ''}
        ${this.errors ? html`<p style="color: red;">Please fix the errors below.</p>` : ''}

        <form method="post">
          <div>
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" value="${this.name ?? ''}" required />
            ${this.errors?.name ? html`<span style="color: red;">${this.errors.name}</span>` : ''}
          </div>

          <div>
            <label for="email">Email:</label>
            <input type="email" id="email" name="email" value="${this.email ?? ''}" required />
            ${this.errors?.email ? html`<span style="color: red;">${this.errors.email}</span>` : ''}
          </div>

          <button type="submit">Submit</button>
        </form>
      </div>
    `;
  }
}
```

## Complex Form

The above example is quite simple, but for a real life application, you might want to have a more complex form with nested fields, arrays, and more advanced validation rules. Cossack supports square bracket notation like PHP for nested fields and arrays, so you can easily handle complex forms.

Here is an example of a complex form with nested fields and arrays

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
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        email: { required: true, email: true, message: 'Email is required and must be valid' },
        'address.street': { required: true, message: 'Street is required' },
        'address.city': { required: true, message: 'City is required' },
      }),
    });

   ...
}

render() {
    return html`
      <form method="post">
        <input type="text" name="name" placeholder="Name" value="${this.name ?? ''}" required />
        ${this.errors?.name ? html`<span style="color: red;">${this.errors.name}</span>` : ''}

        <input type="email" name="email" placeholder="Email" value="${this.email ?? ''}" required />
        ${this.errors?.email ? html`<span style="color: red;">${this.errors.email}</span>` : ''}

        <input type="text" name="address[street]" placeholder="Street" required />
        ${this.errors?.address?.street ? html`<span style="color: red;">${this.errors.address.street}</span>` : ''}

        <input type="text" name="address[city]" placeholder="City" required />
        ${this.errors?.address?.city ? html`<span style="color: red;">${this.errors.address.city}</span>` : ''}

        <button type="submit">Submit</button>
      </form>
    `;
}   
```