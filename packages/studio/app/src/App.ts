import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { studioTheme, type StudioTheme } from './theme.client';

@Page({ transport: 'http' })
export class App extends Cossack {
  @State() theme: StudioTheme = 'dark';

  private disconnectTheme?: () => void;

  async init() {
    const cookie = this.c ? getCookie(this.c, 'cossack-studio-theme') : undefined;
    this.theme = cookie === 'light' ? 'light' : 'dark';
  }

  onMount() {
    const rootTheme: StudioTheme = document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';
    studioTheme.set(rootTheme);
    this.disconnectTheme = studioTheme.subscribe((theme) => {
      this.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.style.colorScheme = theme;
    });
  }

  onCleanup() {
    this.disconnectTheme?.();
  }

  render() {
    return html`
      <div class="min-h-screen bg-background text-foreground antialiased">
        ${this.children}
      </div>
    `;
  }
}
