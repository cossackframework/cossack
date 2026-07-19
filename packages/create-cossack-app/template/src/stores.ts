import { createStore } from '@cossackframework/core';
export const themeStore = createStore<'light' | 'dark'>('dark');
