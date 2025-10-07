import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page('/')
export class IndexPage extends Cossack {
  @State() count = 0;

  increment() {
    this.count++;
  }

  render() {
    return html`
      <h1>Hello Cossack!</h1>
      <p>Count: ${this.count}</p>
      <button @click=${this.increment}>Increment</button>
    `;
  }
}