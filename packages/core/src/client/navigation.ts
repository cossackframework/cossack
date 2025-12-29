export function enableClientNavigation(
    onNavigate: (url: string) => Promise<boolean>,
    onPreFetch?: (url: string) => Promise<void>
) {
    const isLocalLink = (target: HTMLAnchorElement) => {
        const href = target.getAttribute('href');
        return href && 
               !href.startsWith('http') && 
               !href.startsWith('//') && 
               !href.startsWith('#') && 
               !target.hasAttribute('target') &&
               !target.hasAttribute('download');
    };

    // Intercept clicks on links
    document.addEventListener('click', async (e) => {
        const target = (e.target as Element).closest('a');
        if (!target || !isLocalLink(target)) return;

        const href = target.getAttribute('href')!;
        e.preventDefault();
        
        const accepted = await onNavigate(href);
        if (accepted) {
            window.history.pushState({}, '', href);
        }
    });

    // Pre-fetch on hover
    let prefetchTimeout: any;
    document.addEventListener('mouseover', (e) => {
        const target = (e.target as Element).closest('a');
        if (!target || !isLocalLink(target) || !onPreFetch) return;

        const href = target.getAttribute('href')!;
        
        // Wait 50ms of hover before prefetching to avoid noise
        clearTimeout(prefetchTimeout);
        prefetchTimeout = setTimeout(() => {
            onPreFetch(href);
        }, 50);
    });

    // Handle back/forward buttons
    window.addEventListener('popstate', async () => {
        await onNavigate(window.location.pathname + window.location.search);
    });
}