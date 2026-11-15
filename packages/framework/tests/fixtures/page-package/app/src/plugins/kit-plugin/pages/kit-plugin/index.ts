import { Cossack, Page, html } from '@cossackframework/core';

@Page({ transport: 'http' })
export default class KitPluginPage extends Cossack {
  render() {
    return html`<p>KIT_PLUGIN_PAGE</p>`;
  }
}
