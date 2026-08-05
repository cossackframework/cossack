import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
  render() { return html`<div class="min-h-screen bg-background text-foreground">${this.children}</div>`; }
}
