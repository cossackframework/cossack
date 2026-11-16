import { Component, Cossack, html } from '@cossackframework/core';

@Component({ transport: 'durable-object', scope: () => 'kit' })
export class Counter extends Cossack {
  render() {
    return html`<output>0</output>`;
  }
}
