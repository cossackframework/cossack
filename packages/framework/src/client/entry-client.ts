import '../style.css';
import { Cossack } from '@cossackframework/core';

(async () => {
    const container = document.getElementById('root');
    if (!container) {
        console.error('Could not find root container');
        return;
    }

    const initialState = window.__INITIAL_STATE__;
    const componentPath = initialState?.componentPath;

    if (!componentPath) {
        console.error('Could not find componentPath in initial state');
        return;
    }

    const pageModules = import.meta.glob('../pages/**/index.ts', { eager: true });
    const module = pageModules[componentPath] as any;

    if (!module) {
        console.error(`Component module not found for path: ${componentPath}`);
        return;
    }

    const PageComponent = Object.values(module)[0] as new () => Cossack;

    if (PageComponent) {
        const componentInstance = new PageComponent();
        await componentInstance.bootstrap({ container, initialState });
    } else {
        console.error(`Could not extract component from module: ${componentPath}`);
    }
})();
