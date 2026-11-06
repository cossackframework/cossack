/** The search box in the header. Menus are `helpers.menu()`, the language switcher `helpers.languages()`. */
import { html, type TemplateResult } from '@cossackframework/renderer';

export function searchBox(action: string, className = ''): TemplateResult {
    return html`<form action=${action} method="get" role="search" class=${className}>
        <input type="search" name="q" placeholder=${__('Search')} aria-label=${__('Search')}
            class="w-44 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
    </form>`;
}
