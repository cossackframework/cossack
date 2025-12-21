export function enableClientNavigation(onNavigate: (url: string) => Promise<void>) {
    // Intercept clicks on links
    document.addEventListener('click', async (e) => {
        const target = (e.target as Element).closest('a');
        if (!target) return;

        const href = target.getAttribute('href');
        // Ignore external links, anchors, or special protocols
        if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#') || target.hasAttribute('target')) {
            return;
        }

        e.preventDefault();
        
        // Push state
        window.history.pushState({}, '', href);
        
        // Navigate
        await onNavigate(href);
    });

    // Handle back/forward buttons
    window.addEventListener('popstate', async () => {
        await onNavigate(window.location.pathname + window.location.search);
    });
}
