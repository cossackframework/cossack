import { Client, Cossack, Page, Server, State } from '@cossackframework/core';
import { html, bind, preventDefault } from '@cossackframework/renderer';

// Want to have rich state management when submitting forms?
// This page demonstrates how to use @State() and @Server() decorators to manage form state and handle server-side logic in a Cossack application.
// Also use bind() for two-way data binding between the input field and the component's state.
// And use loading state to disable the submit button while the serverHandle() method is executing.
// `preventDefault(this.serverHandle)` is a directive that calls preventDefault() on the
// submit event before invoking the server method, and also disables browser-native
// validation (use @Validate/custom validation instead). See /http docs for more.
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

        <form @submit="${preventDefault(this.serverHandle)}">
          <div>
            <label for="name">Name:</label>
            <input type="text" id="name" name="name" .value="${bind(this, 'name')}" required />
          </div>
          <button type="submit" ?disabled="${this.loading['serverHandle']}">
            ${this.loading['serverHandle'] ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>
    `;
  }
}
