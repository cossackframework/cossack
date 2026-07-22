import { createStore } from '@cossackframework/core';

export type Theme = 'light' | 'dark';

// This top-level browser access is safe because the real module is never
// evaluated during SSR. The security plugin substitutes export placeholders.
const savedTheme = window.localStorage.getItem('client-only-example-theme');

export const themeStore = createStore<Theme>(savedTheme === 'light' ? 'light' : 'dark');

export function describeBrowser(): string {
    return `${window.navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`;
}

export function saveTheme(theme: Theme): void {
    window.localStorage.setItem('client-only-example-theme', theme);
}
