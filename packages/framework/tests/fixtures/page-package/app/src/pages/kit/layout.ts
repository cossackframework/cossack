import { Cossack, html } from '@cossackframework/core';

export default class KitLayout extends Cossack {
  render() {
    return html`<section data-kit-layout>${this.children}</section>`;
  }
}
