import { createStore } from '@cossackframework/core';

export type Theme = 'light' | 'dark';

function initialTheme(): Theme {
    // root.ts resolves the cookie/system preference before the browser paints.
    // Read that result instead of replacing it with an SSR fallback on mount.
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark';
}

export const themeStore = createStore<Theme>(initialTheme());
