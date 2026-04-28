import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class NotFoundPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Page Not Found' };
    }

    render() {
        return html`
            <div class="text-center py-20 px-8">
                <h1 class="text-[4rem] mb-4">404</h1>
                <p class="text-2xl text-gray-500 mb-8">Oops! The page you're looking for doesn't exist.</p>
                <a href="/" class="text-blue-600 no-underline font-bold">&larr; Go back home</a>
            </div>
        `;
    }
}
