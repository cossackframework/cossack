import { Client, Cossack, Page, Server, State } from '@cossackframework/core';
import { html, bind, component } from '@cossackframework/renderer';
import { Button, Form } from '@cossackframework/ui';

// Want to have rich state management when submitting forms?
// This page demonstrates how to use @State() and @Server() decorators to manage form state and handle server-side logic in a Cossack application.
// Also use bind() for two-way data binding between the input field and the component's state.
// And use loading state to disable the submit button while the serverHandle() method is executing.
// The `Form` component wraps `<form>`, prevents the native submit (page reload),
// and adds `novalidate` so you can use custom/@Validate validation instead of the
// browser's native HTML5 checks. See /docs/forms.md for more.
@Page({ transport: 'http' })
export default class BasicState extends Cossack {
  @State()
  name: string = 'Guest';

  @Server()
  serverHandle() {
    const name = this.name;

    console.log(`Form submitted with name: ${name}`);
  }

  render() {
    return html`
      <div>
        <h1>Basic State Page</h1>
        <p>Hello, ${this.name}!</p>

        ${component(
          Form,
          { submit: this.serverHandle },
          html`
            <div>
              <label for="name">Name:</label>
              <input type="text" id="name" name="name" .value="${bind(this, 'name')}" required />
            </div>
            ${component(
              Button,
              { type: 'submit', '?disabled': this.loading['serverHandle'] },
              this.loading['serverHandle'] ? 'Submitting...' : 'Submit',
            )}
          `,
        )}
      </div>
    `;
  }
}
