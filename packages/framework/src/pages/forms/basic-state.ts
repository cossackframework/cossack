import { Client, Cossack, Page, Server, State, Store } from '@cossackframework/core';
import { html, bind, component } from '@cossackframework/renderer';
import { Button, Form, Input } from '@cossackframework/ui';

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

  @Store()
  address: {
    street: string;
    city: string;
    zip: string;
  } = {
    street: 'An Khanh',
    city: 'Hanoi',
    zip: '100000',
  }

  @Server()
  serverHandle() {
    const name = this.name;

    console.log(`Form submitted with name: ${name}`);
    console.log(`Form submitted with address: ${JSON.stringify(this.address)}`);
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
              ${component(Input, { name: 'name', '.value': bind(this, 'name') })}
            </div>
            <div>
              <label for="street">Street:</label>
              ${component(Input, { name: 'street', '.value': bind(this, 'address.street') })}
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
