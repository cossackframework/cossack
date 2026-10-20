/** The 404 page. */
import { html, type TemplateResult } from '@cossackframework/renderer';

export default function notFound(): TemplateResult {
    return html`<section class="space-y-3 py-16 text-center">
        <h1 class="text-3xl font-bold text-foreground">${__('Page not found')}</h1>
        <p class="text-muted-foreground">${__('The page you are looking for does not exist.')}</p>
        <a href="/" class="text-primary hover:underline">${__('Go to the home page')}</a>
    </section>`;
}
