import { Cossack, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
  render(children: TemplateResult) {
    return html`
      <div class="auth-layout" style="display: flex; justify-content: center; align-items: center; min-height: 80vh; background: #f0f2f5;">
        <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px;">
          <h2 style="text-align: center; color: #333; margin-bottom: 1.5rem;">Cossack Auth</h2>
          ${children}
          <div style="margin-top: 1.5rem; text-align: center; font-size: 0.9rem;">
             <a href="/" style="color: #666;">&larr; Back to Home</a>
          </div>
        </div>
      </div>
    `;
  }
}
