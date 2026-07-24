import { Cossack, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, Input, Label, Typography } from '@cossackframework/ui';

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
        ${component(Typography, { variant: 'h1' }, 'Form')}
        <p>Hello, ${this.c.req.query('name') ? this.c.req.query('name') : 'Guest'}!</p>
        <form method="post" class="mt-6 max-w-md space-y-4">
          <div class="space-y-2">
            ${component(Label, { for: 'name' }, 'Name')}
            ${component(Input, { type: 'text', id: 'name', name: 'name', required: true })}
          </div>
          ${component(Button, { type: 'submit' }, 'Submit')}
        </form>
      </div>
    `;
  }
}
