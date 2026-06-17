/**
 * Navigation options passed from a click interceptor or programmatic
 * navigation through to the framework's navigate() implementation.
 */
export interface NavigateOptions {
    /**
     * View Transition types to apply to the navigation. Corresponds to the
     * `types` field on `document.startViewTransition({ update, types })`.
     * Authors target these in CSS via `::view-transition-group(.<type>)`.
     */
    types?: string[];
}

/**
 * Feature-detect the browser View Transitions API. Returns true when
 * `document.startViewTransition` is available. Safe to call on the server
 * (returns false because `document` is undefined).
 */
export function supportsViewTransitions(): boolean {
    return typeof document !== 'undefined' &&
        typeof (document as any).startViewTransition === 'function';
}

export function enableClientNavigation(
    onNavigate: (url: string, options?: NavigateOptions) => Promise<boolean>,
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

    // Read `data-transition-types` from an anchor and split on whitespace.
    // Returns undefined when the attribute is missing or empty so callers
    // can distinguish "no types" from "empty types".
    const readTransitionTypes = (target: HTMLAnchorElement): string[] | undefined => {
        const raw = target.dataset.transitionTypes;
        if (!raw) return undefined;
        const types = raw.split(/\s+/).filter(Boolean);
        return types.length ? types : undefined;
    };

    // Intercept clicks on links
    document.addEventListener('click', async (e) => {
        const target = (e.target as Element).closest('a');
        if (!target || !isLocalLink(target)) return;

        const href = target.getAttribute('href')!;
        e.preventDefault();

        const options: NavigateOptions | undefined = (() => {
            const types = readTransitionTypes(target);
            return types ? { types } : undefined;
        })();

        const accepted = await onNavigate(href, options);
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

    // Handle back/forward buttons.
    // Browser-initiated back/forward navigations carry no transition types —
    // matching Next.js's behavior. Authors who need "back" semantics can
    // detect them via `navigationType: 'spa'` in the `cossack:ready` event.
    window.addEventListener('popstate', async () => {
        await onNavigate(window.location.pathname + window.location.search);
    });
}
