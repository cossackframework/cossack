import { Cossack, Page, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';

const STORAGE_KEY = 'cossack.desktop.counter';

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @State() count = 0;

  async init() {
    if (!this.isDesktop) return;
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    this.count = Number.isFinite(value) ? value : 0;
  }

  increment() {
    this.count += 1;
    if (this.isDesktop) {
      localStorage.setItem(STORAGE_KEY, String(this.count));
    }
  }

  decrement() {
    this.count -= 1;
    if (this.isDesktop) {
      localStorage.setItem(STORAGE_KEY, String(this.count));
    }
  }

  render() {
    return html`
      <main class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-8 text-center">
        <div>
          <p class="text-sm text-muted-foreground">${this.isDesktop ? 'Deno Desktop · persistent' : 'Web · in memory'}</p>
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
