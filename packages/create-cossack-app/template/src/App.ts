import { Cossack, Page, State, Client } from '@cossackframework/core';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { Toaster } from '@cossackframework/ui';
import { getCookie } from 'hono/cookie';
import { themeStore } from './stores.client';

/**
 * Root application component.
 *
 * Owns the theme (light/dark) via the global `themeStore` so any page can
 * toggle it. The `.dark` class is applied to `<html>` (NOT a wrapper div) —
 * by the inline anti-FOUC script in root.ts before first paint, and kept in
 * sync here via a themeStore subscription. This ensures the dark CSS variables
 * cascade to every element (body, layouts, components).
 *
 * Default is dark; the first visit with no stored preference falls back to the
 * user's prefers-color-scheme, then dark. The choice persists in a cookie
 * (cs-theme) so SSR reads it and the anti-FOUC script paints correctly.
 */
@Page({ transport: 'http' })
export class App extends Cossack {
    @State() savedTheme: 'light' | 'dark' | null = null;
    @State() theme: 'light' | 'dark' = 'dark';

    private _unsub?: () => void;

    onCleanup() {
        this._unsub?.();
    }

    onMount() {
        themeStore.set(this.savedTheme ?? this.theme);

        // Keep <html> in sync with themeStore so toggles from any page update
        // the .dark class on the document root (where the CSS expects it).
        this._unsub = themeStore.subscribe((value) => {
            this.theme = value;
            if (typeof document !== 'undefined') {
                document.documentElement.classList.toggle('dark', value === 'dark');
                document.documentElement.style.colorScheme = value;
            }
        });
    }

    async init() {
        // Read theme from cookie (SSR) so the anti-FOUC script + initial paint
        // match without a flash.
        this.savedTheme = this.c
            ? (getCookie(this.c, 'cs-theme') === 'dark' ? 'dark' : 'light')
            : null;

        this.theme = this.savedTheme ?? 'dark';
    }

    render() {
        return html`
            <div class="min-h-screen bg-background text-foreground antialiased">
                ${this.children}
                ${component(Toaster)}
            </div>
        `;
    }
}
