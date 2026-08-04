import { Client, ClientState, Cossack, Page } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';
import { createDesktopClient } from '@cossackframework/deno-adapter/desktop/client';
import type { desktopBindings } from '../desktop/bindings';

const desktop = createDesktopClient<typeof desktopBindings>();

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @ClientState() count = 0;

  @Client()
  async clientInit() {
    if (desktop.available) this.count = await desktop.invoke('loadCount');
  }

  @Client()
  async increment() {
    this.count += 1;
    if (desktop.available) await desktop.invoke('saveCount', this.count);
  }

  @Client()
  async decrement() {
    this.count -= 1;
    if (desktop.available) await desktop.invoke('saveCount', this.count);
  }

  render() {
    return html`
      <main class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-8 text-center">
        <div>
          <p class="text-sm text-muted-foreground">${desktop.available ? 'Deno Desktop · persistent' : 'Web · in memory'}</p>
          <h1 class="text-3xl font-semibold">Cossack counter</h1>
        </div>
        <output class="text-7xl font-bold tabular-nums" aria-live="polite">${this.count}</output>
        <div class="flex gap-3">
          ${component(Button, { variant: 'outline', '@click': this.decrement }, '−')}
          ${component(Button, { '@click': this.increment }, '+')}
        </div>
      </main>`;
  }
}
