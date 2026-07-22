import { Cossack, Page, Server } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class RootLayout extends Cossack {
  render() {
    return html`
      <div class="root-layout">
        <header class="p-4 border-b border-gray-300">
          <strong>
          <img src="/logo.svg" alt="Cossack Logo" class="inline-block w-6 h-6 mr-2" />
          Cossack Framework</strong>
          <nav class="inline-block ml-8">
            <a href="/" class="no-underline text-inherit ${this.isActive('/', true) ? 'font-bold text-blue-500 underline' : ''}">Home</a> |
            <a href="/contact" class="no-underline text-inherit ${this.isActive('/contact') ? 'font-bold text-blue-500 underline' : ''}">Contact</a> |
            <a href="/optimistic-counter" class="no-underline text-inherit ${this.isActive('/optimistic-counter') ? 'font-bold text-blue-500 underline' : ''}">Optimistic</a> |
            <a href="/prevent-navigation" class="no-underline text-inherit ${this.isActive('/prevent-navigation') ? 'font-bold text-blue-500 underline' : ''}">Prevent Nav</a> |
            <a href="/lifecycle" class="no-underline text-inherit ${this.isActive('/lifecycle') ? 'font-bold text-blue-500 underline' : ''}">Loading UI</a> |
            <a href="/task-tracker" class="no-underline text-inherit ${this.isActive('/task-tracker') ? 'font-bold text-blue-500 underline' : ''}">Task Tracker</a>
            | <a href="/examples/server-functions" class="no-underline text-inherit ${this.isActive('/examples/server-functions') ? 'font-bold text-blue-500 underline' : ''}">server$</a>
          </nav>
        </header>
        <div class="p-8">
          ${this.children}
        </div>
        <footer class="p-4 border-t border-gray-300 mt-8 text-xs">
          Built with Cossack
        </footer>
      </div>
    `;
  }
}
