import { Cossack } from '@cossackframework/framework';
import { html } from '@cossackframework/renderer';

export class Root extends Cossack {
  render() {
    return html`<h1>Hello, Cossack!</h1>`;
  }
}
