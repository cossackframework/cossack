import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

// This page demonstrates a bare minimum form submission and redirection using the Cossack framework.
// This concept of form handling and post requests is similar to how you would handle forms in a traditional web application, 
// but with the added benefits of Cossack's reactive rendering and server-side capabilities.
// If you want to have rich state management when submitting forms, check out the `basic-state.ts` page in this directory.
// If you want to have validation and error handling when submitting forms, check out the /validation page or /store-validation page
@Page({ transport: 'http' })
export default class FormIndex extends Cossack {
  
  async post() {
    const formData = await this.c.req.formData();
    const name = formData.get('name') as string;
    return this.c.redirect(`/forms?name=${encodeURIComponent(name)}`);
  }

  render() {
    return html`
      <div>
        <h1>Form</h1>
        <p>Hello, ${this.c.req.query('name') ? this.c.req.query('name') : 'Guest'}!</p>
        <form method="post">
          <div>
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" required />
          </div>
          <button type="submit">Submit</button>
        </form>
      </div>
    `;
  }
}
