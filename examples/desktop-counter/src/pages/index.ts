import { Cossack, Image, Page, Server, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';
import type { DesktopShell } from '@cossackframework/desktop';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

@Page({ transport: 'http' })
export default class CounterPage extends Cossack {
  @State() count = 0;
  @State() notificationStatus = '';

  async init() {
    if (!this.isDesktop) return;
    try {
      const value = Number.parseInt(await readFile(this.storagePath(), 'utf8'), 10);
      this.count = Number.isFinite(value) ? value : 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.updateBadge();
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
    const shell = this.desktopShell();
    const result = await shell.dialog.showMessageBox(shell.window, {
      type: 'question', buttons: ['Reset', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Reset the persisted counter to zero?',
    });
    if (result.response !== 0) return;
    this.count = 0;
    this.notificationStatus = '';
    await this.persist();
  }

  @Server()
  async notify() {
    if (!this.isDesktop) return;
    const shell = this.desktopShell();
    if (!shell.Notification.isSupported()) {
      this.notificationStatus = 'Native notifications are unavailable on this system.';
      return;
    }
    const notification = new shell.Notification({
      title: 'Cossack Counter',
      body: `The current count is ${this.count}.`,
    });
    notification.on('click', () => { shell.show(); shell.focus(); });
    notification.show();
    this.notificationStatus = 'Notification sent.';
  }

  @Server()
  async about() {
    if (!this.isDesktop) return;
    const shell = this.desktopShell();
    await shell.dialog.showMessageBox(shell.window, {
      type: 'info', message: 'Cossack Counter', detail: 'An Electron native-capability showcase.',
    });
  }

  @Server()
  quit() {
    if (this.isDesktop) this.desktopShell().quit();
  }

  async persist() {
    if (!this.isDesktop) return;
    const target = this.storagePath();
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, String(this.count), 'utf8');
    await rename(temporary, target);
    this.updateBadge();
  }

  desktopShell(): DesktopShell {
    const shell = this.env.COSSACK_DESKTOP as DesktopShell | undefined;
    if (!shell) throw new Error('COSSACK_DESKTOP is unavailable outside Electron.');
    return shell;
  }

  storagePath(): string {
    return path.join(this.desktopShell().app.getPath('userData'), 'counter.txt');
  }

  updateBadge() {
    const shell = this.desktopShell();
    if (process.platform === 'darwin') shell.dock?.setBadge(this.count === 0 ? '' : String(this.count));
    if (process.platform === 'linux') shell.setBadge(this.count === 0 ? null : this.count);
    if (process.platform === 'win32') {
      if (this.count === 0) return shell.setOverlayIcon(null);
      const label = String(this.count).slice(-3);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#dc2626"/><text x="16" y="21" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="white">${label}</text></svg>`;
      shell.setOverlayIcon(shell.nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`), `Count ${this.count}`);
    }
  }

  render() {
    const content = html`
      <main class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-8 text-center">
        ${Image({ src: '/logo.svg', width: 64, height: 64, alt: 'Cossack Framework' })}
        <div>
          <p class="text-sm text-muted-foreground">${this.isDesktop ? 'Desktop · persistent' : 'Web · in memory'}</p>
          <h1 class="text-3xl font-semibold">Cossack counter</h1>
        </div>
        <output class="text-7xl font-bold tabular-nums" aria-live="polite">${this.count}</output>
        <div class="flex gap-3">
          ${component(Button, {
            variant: 'outline',
            'data-counter-action': 'decrement',
            '@click': this.decrement,
          }, '-')}
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

    return content;
  }
}
