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

// This page demonstrates the full POST → redirect → GET pattern with:
//   - typed + validated nested form data (`getFormData<T>()` + `storeRules<T>`)
//   - flash messages (`flash` / `flashed`) — one-shot data carried across the redirect
//   - old input repopulation (`flashInput` / `old`) — keeps field values on validation failure
//   - NESTED validation errors — `errors.address.city` works (optional chaining),
//     matching the form's type shape. Flat-key access is available via `flatErrors`.
//
// Flash data is signed-cookie-backed (stateless) and lives for exactly one
// redirect. It requires an `APP_SECRET` env var. See the /http docs.

interface AddressForm {
  street: string;
  city: string;
  state: string;
}

interface ComplexFormShape {
  name: string;
  address: AddressForm;
}

@Page({ transport: 'http' })
export default class ComplexForm extends Cossack {
  @State()
  success: string | undefined;

  @State()
  errors: {
    name?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
    };
  } | undefined;

  @State()
  name: string = '';

  @State()
  address: AddressForm = { street: '', city: '', state: '' };

  async init() {
    // Read flashed data on the GET that follows the redirect.
    this.success = flashed<string>('success');
    this.errors = flashed('errors');
    this.name = old<string>('name') ?? '';
    this.address = old<AddressForm>('address') ?? { street: '', city: '', state: '' };
  }

  async post() {
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        'address.street': { required: true, message: 'Street is required' },
        'address.city': { required: true, message: 'City is required' },
        'address.state': { required: true, minLength: 2, message: 'State is required (min 2 chars)' },
      }),
    });

    // Repopulate the submitted values on either branch so the user keeps them.
    flashInput(data as unknown as Record<string, unknown>);

    if (!valid) {
      flash('errors', errors); // nested shape: errors.address.city
      return this.back();      // redirect to Referer (returns the Response)
    }

    console.log('Validated form data:', data.name, data.address.street);
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

          <h3>Address</h3>
          <div>
            <label for="street">Street:</label>
            <input type="text" id="street" name="address[street]" value="${this.address?.street ?? ''}" required />
            ${this.errors?.address?.street
              ? html`<span style="color: red;">${this.errors.address.street}</span>`
              : ''}
          </div>

          <div>
            <label for="city">City:</label>
            <input type="text" id="city" name="address[city]" value="${this.address?.city ?? ''}" required />
            ${this.errors?.address?.city
              ? html`<span style="color: red;">${this.errors.address.city}</span>`
              : ''}
          </div>

          <div>
            <label for="state">State:</label>
            <input type="text" id="state" name="address[state]" value="${this.address?.state ?? ''}" required />
            ${this.errors?.address?.state
              ? html`<span style="color: red;">${this.errors.address.state}</span>`
              : ''}
          </div>

          <button type="submit">Submit</button>
        </form>
      </div>
    `;
  }
}
