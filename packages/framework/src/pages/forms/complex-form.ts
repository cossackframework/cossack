import { Cossack, Page, storeRules } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

// This page demonstrates typed + validated complex (nested) form data using
// PHP-style bracket `name` attributes and Cossack's built-in validation.
//
// HTML inputs use bracket names like `address[street]`; on submit the browser
// sends a flat FormData with literal keys "address[street]". `getFormData<T>()`
// parses that into a nested object typed as `T`, and the optional `rules`
// (built with `storeRules<T>()`) run Cossack's built-in validators at runtime —
// the same vocabulary used by `@Store`/`@Validate` components.
//
// See the /http docs for the full bracket syntax and the typed+validated flow.

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
export default class FormIndex extends Cossack {

  async post() {
    // Typed + validated in one call. `data` is typed `ComplexFormShape`;
    // `errors` is a dot-path -> message map; `valid` is the aggregate flag.
    const { data, errors, valid } = await this.c.getFormData<ComplexFormShape>({
      rules: storeRules<ComplexFormShape>({
        name: { required: true, message: 'Name is required' },
        'address.street': { required: true, message: 'Street is required' },
        'address.city': { required: true, message: 'City is required' },
        'address.state': { required: true, minLength: 2, message: 'State is required (min 2 chars)' },
      }),
    });

    if (!valid) {
      return this.c.json({ errors }, 400);
    }

    console.log('Validated form data:', data.name, data.address.street);
    return this.c.json({ ok: true });
  }

  render() {
    return html`
      <div>
        <h1>Complex Form</h1>
        <p>Hello, ${this.c.req.query('name') ? this.c.req.query('name') : 'Guest'}!</p>
        <form method="post">
          <div>
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" required />
          </div>

          <h3>Address</h3>
          <div>
            <label for="street">Street:</label>
            <input type="text" id="street" name="address[street]" required />
          </div>

          <div>
            <label for="city">City:</label>
            <input type="text" id="city" name="address[city]" required />
          </div>

          <div>
            <label for="state">State:</label>
            <input type="text" id="state" name="address[state]" required />
          </div>

          <button type="submit">Submit</button>
        </form>
      </div>
    `;
  }
}
