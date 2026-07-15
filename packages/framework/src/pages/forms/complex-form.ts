import {
  Cossack,
  Page,
  storeRules,
  flash,
  State,
  Store,
  type NestedErrors,
} from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, Input } from '@cossackframework/ui';

// This page demonstrates the full POST → redirect → GET pattern with:
//   - typed + validated nested form data (`getFormData<T>()` + `storeRules<T>`)
//   - auto-bound flash/old data — `@State({ flash })` / `@Store({ old })` pull
//     flashed values and old input into state during bootstrap, so there's no
//     `init()` boilerplate. (`getFormData()` auto-flashes both by default.)
//   - NESTED validation errors — `hasError('address.city')` / `getError('address.city')`
//     resolve nested fields by dot-path, matching the form's type shape.
//
// Flash data is signed-cookie-backed (stateless) and lives for exactly one
// redirect. It requires an `APP_SECRET` env var. See /docs/session.md.

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
  // `flash: true` auto-binds `flashed('success')` during bootstrap.
  @State({ flash: true })
  success: string | undefined;

  // Auto-binds the flashed `errors` object.
  @State({ flash: true })
  errors: NestedErrors<ComplexFormShape> | undefined;

  // `old: true` auto-binds `old('name')`, falling back to '' when nothing was
  // flashed.
  @State({ old: true })
  name: string = '';

  // A @Store auto-binds the whole old-input object at once (`old('address')`).
  @Store({ old: true })
  address: AddressForm = { street: '', city: '', state: '' };

  async post() {
    // `getFormData()` auto-flashes the parsed input (for `old()`) and the nested
    // `errors` (when invalid) to the next request — no manual flashInput/flash
    // needed. Disable with `{ flash: false }`.
    const { data, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        address: {
          street: { required: true, message: 'Street is required' },
          city: { required: true, message: 'City is required' },
          state: { required: true, minLength: 2, message: 'State is required (min 2 chars)' },
        },
      }),
    });

    if (!valid) {
      // errors + old input were auto-flashed above; just redirect back.
      return this.back();
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

        <form method="post" novalidate>
          <div>
            <label for="name">Name:</label>
            ${component(Input, { name: 'name', value: this.name ?? '' })}
            ${this.hasError('name') ? html`<span class="text-red-500 text-sm">${this.getError('name')}</span>` : ''}
          </div>

          <fieldset>
            <legend>Address</legend>
            <div>
              <label for="street">Street:</label>
              ${component(Input, { name: 'address[street]', value: this.address?.street ?? '' })}
              ${this.hasError('address.street') ? html`<span class="text-red-500 text-sm">${this.getError('address.street')}</span>` : ''}
            </div>

            <div>
              <label for="city">City:</label>
              ${component(Input, { name: 'address[city]', value: this.address?.city ?? '' })}
              ${this.hasError('address.city') ? html`<span class="text-red-500 text-sm">${this.getError('address.city')}</span>` : ''}
            </div>

            <div>
              <label for="state">State:</label>
              ${component(Input, { name: 'address[state]', value: this.address?.state ?? '' })}
              ${this.hasError('address.state') ? html`<span class="text-red-500 text-sm">${this.getError('address.state')}</span>` : ''}
            </div>
          </fieldset>

          ${component(Button, { type: 'submit', variant: 'default'}, 'Submit')}
        </form>
      </div>
    `;
  }
}
