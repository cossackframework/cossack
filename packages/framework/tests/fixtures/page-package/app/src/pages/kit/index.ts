import { Client, Cossack, Page, Server, State, html, server$ } from '@cossackframework/core';
// A module the application provides: the host contract.
import { hostName } from '@/kit/host';
import { readSecret } from '../../lib/server-only';
import { Counter } from '../../components/Counter';

@Page({ transport: 'http' })
export default class KitPage extends Cossack {
  @State() count = 0;

  greeting = server$(async () => `KIT_RESOURCE_SECRET ${hostName}`, { initial: '' });

  @Server()
  async save() {
    return `KIT_SERVER_SECRET ${readSecret()}`;
  }

  @Client()
  mark() {
    console.log('KIT_CLIENT_MARKER');
  }

  render() {
    return html`<button data-host=${hostName} @click=${this.mark}>${this.count}</button><button @click=${this.save}>save</button>${Counter.name}`;
  }
}
