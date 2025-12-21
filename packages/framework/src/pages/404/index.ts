import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class NotFoundPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Page Not Found' };
    }

    template() {
        return html`
            <div style="text-align: center; padding: 5rem 2rem;">
                <h1 style="font-size: 4rem; margin-bottom: 1rem;">404</h1>
                <p style="font-size: 1.5rem; color: #666; margin-bottom: 2rem;">Oops! The page you're looking for doesn't exist.</p>
                <a href="/" style="color: #0070f3; text-decoration: none; font-weight: bold;">&larr; Go back home</a>
            </div>
        `;
    }
}