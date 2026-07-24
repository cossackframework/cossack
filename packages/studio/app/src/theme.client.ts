import { createStore } from '@cossackframework/core';

export type StudioTheme = 'light' | 'dark';

export const studioTheme = createStore<StudioTheme>('dark');
