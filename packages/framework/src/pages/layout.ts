import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class RootLayout extends Cossack {
  render() {
    return html`
      <style>
        .nav-link { text-decoration: none; color: inherit; }
        .nav-link.active { font-weight: bold; color: #3b82f6; text-decoration: underline; }
      </style>
      <div class="root-layout">
        <header style="padding: 1rem; border-bottom: 1px solid #ccc;">
          <strong>Cossack Framework</strong>
          <nav style="display: inline-block; margin-left: 2rem;">
            <a href="/" class="nav-link ${this.isActive('/', true) ? 'active' : ''}">Home</a> | 
            <a href="/contact" class="nav-link ${this.isActive('/contact') ? 'active' : ''}">Contact</a> | 
            <a href="/optimistic-counter" class="nav-link ${this.isActive('/optimistic-counter') ? 'active' : ''}">Optimistic</a> |
            <a href="/prevent-navigation" class="nav-link ${this.isActive('/prevent-navigation') ? 'active' : ''}">Prevent Nav</a> |
            <a href="/lifecycle" class="nav-link ${this.isActive('/lifecycle') ? 'active' : ''}">Loading UI</a>
          </nav>
        </header>
        <div style="padding: 2rem;">
          ${this.children}
        </div>
        <footer style="padding: 1rem; border-top: 1px solid #ccc; margin-top: 2rem; font-size: 0.8rem;">
          Built with Cossack
        </footer>
      </div>
    `;
  }
}
