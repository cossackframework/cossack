import { Cossack, Image, Page, Server, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, ContextMenu } from '@cossackframework/ui';

const STORAGE_KEY = 'cossack.desktop.counter';

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @State() count = 0;
  @State() notificationStatus = '';

  async init() {
    if (!this.isDesktop) return;
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    this.count = Number.isFinite(value) ? value : 0;
    await this.persist();
  }

  @Server()
  async increment() {
    this.count += 1;
    await this.persist();
  }

  @Server()
  async decrement() {
    this.count -= 1;
    await this.persist();
  }

  @Server()
  async reset() {
    if (!this.isDesktop) return;
    const { createDesktopShell } = await import('@cossackframework/deno-adapter/desktop');
    const shell = createDesktopShell();
    if (!shell.dialogs.confirm('Reset the persisted counter to zero?')) return;
    this.count = 0;
    this.notificationStatus = '';
    await this.persist();
  }

  @Server()
  async notify() {
    if (!this.isDesktop) return;
    const { createDesktopShell } = await import('@cossackframework/deno-adapter/desktop');
    const shell = createDesktopShell();
    const permission = shell.notifications.permission === 'granted'
      ? 'granted'
      : await shell.notifications.requestPermission();
    if (permission !== 'granted') {
      this.notificationStatus = 'Notifications are denied. Enable them in system settings.';
      return;
    }
    const notification = shell.notifications.show('Cossack Counter', {
      body: `The current count is ${this.count}.`,
      tag: 'cossack-counter-count',
    });
    notification.addEventListener('click', () => {
      shell.window?.show();
      shell.window?.focus();
    });
    this.notificationStatus = 'Notification sent.';
  }

  @Server()
  async about() {
    if (!this.isDesktop) return;
    const { createDesktopShell } = await import('@cossackframework/deno-adapter/desktop');
    createDesktopShell().dialogs.alert('Cossack Counter\nA Deno Desktop native-capability showcase.');
  }

  @Server()
  quit() {
    if (this.isDesktop) Deno.exit(0);
  }

  async persist() {
    if (!this.isDesktop) return;
    localStorage.setItem(STORAGE_KEY, String(this.count));
    const { createDesktopShell } = await import('@cossackframework/deno-adapter/desktop');
    createDesktopShell().dock.setBadge(this.count === 0 ? null : String(this.count));
  }

  render() {
    const content = html`
      <main class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-8 text-center">
        ${Image({ src: '/logo.svg', width: 64, height: 64, alt: 'Cossack Framework' })}
        <div>
          <p class="text-sm text-muted-foreground">${this.isDesktop ? 'Deno Desktop · persistent' : 'Web · in memory'}</p>
          <h1 class="text-3xl font-semibold">Cossack counter</h1>
        </div>
        <output class="text-7xl font-bold tabular-nums" aria-live="polite">${this.count}</output>
        <div class="flex gap-3">
          ${component(Button, {
            variant: 'outline',
            'data-counter-action': 'decrement',
            '@click': this.decrement,
          }, '−')}
          ${component(Button, {
            'data-counter-action': 'increment',
            '@click': this.increment,
          }, '+')}
        </div>
        ${this.isDesktop ? html`
          <div class="flex gap-3">
            ${component(Button, { variant: 'outline', '@click': this.reset }, 'Reset')}
            ${component(Button, { variant: 'secondary', '@click': this.notify }, 'Notify')}
          </div>
          ${this.notificationStatus
            ? html`<p class="text-sm text-muted-foreground" role="status">${this.notificationStatus}</p>`
            : ''}
        ` : ''}
      </main>`;

    if (!this.isDesktop) return content;
    return component(ContextMenu, {
      items: [
        { label: 'Increment count', onClick: this.increment },
        { label: 'Decrement count', onClick: this.decrement },
        { separator: true, label: 'About Cossack Counter', onClick: this.about },
        { label: 'Send notification', onClick: this.notify },
        { separator: true, label: 'Quit', destructive: true, onClick: this.quit },
      ],
    }, html`<div class="min-h-screen w-screen">${content}</div>`);
  }
}
