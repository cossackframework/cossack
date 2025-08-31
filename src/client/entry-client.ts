// src/client/entry-client.ts
import '@/style.css';
import { Cossack } from '@/shared/cossack';

const initialize = async () => {
    // Use Vite's glob import to discover all page components
    const pages = import.meta.glob('/src/pages/**/index.ts');
    const path = window.location.pathname;

    // Find the corresponding page component for the current path
    let componentModule = null;
    for (const pagePath in pages) {
        const route = pagePath
            .replace('/src/pages', '')
            .replace('/index.ts', '')
            .replace(/\[(\w+)\]/g, '([^/]+)') || '/';
        
        const regex = new RegExp(`^${route}$`);
        if (regex.test(path)) {
            componentModule = pages[pagePath];
            break;
        }
    }

    if (componentModule) {
        const module = await componentModule();
        const PageComponent = Object.values(module as object)[0] as new () => Cossack;
        if (PageComponent) {
            const container = document.getElementById('root');
            if (!container) {
                console.error('Root container #root not found');
                return;
            }
            // Instantiate the component to hydrate the page
            const componentInstance = new PageComponent();
            componentInstance.bootstrap({ container });
        } else {
            console.error('Page component not found in module', module);
        }
    } else {
        console.error('No page component found for path:', path);
    }
};

document.addEventListener('DOMContentLoaded', initialize);
