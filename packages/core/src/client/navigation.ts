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
    /**
     * Control scrolling after this navigation. `auto` follows browser-like
     * semantics: new entries go to a fragment or the top, while history
     * traversal restores the destination entry's saved position.
     */
    scroll?: NavigationScrollBehavior;
    /** @internal Identifies browser back/forward traversal. */
    navigationType?: NavigationType;
}

export type NavigationScrollBehavior = 'auto' | 'top' | 'preserve';
export type NavigationType = 'push' | 'traverse';

export interface ScrollPosition {
    x: number;
    y: number;
}

const COSSACK_NAVIGATION_STATE = '__cossackNavigation';

type NavigationHistoryState = Record<string, unknown> & {
    [COSSACK_NAVIGATION_STATE]?: {
        scroll?: ScrollPosition;
    };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function historyStateWithScroll(state: unknown, scroll: ScrollPosition): NavigationHistoryState {
    const base: NavigationHistoryState = isRecord(state) ? { ...state } : {};
    const existing = isRecord(base[COSSACK_NAVIGATION_STATE])
        ? base[COSSACK_NAVIGATION_STATE]
        : {};
    base[COSSACK_NAVIGATION_STATE] = { ...existing, scroll };
    return base;
}

/** Save the current viewport position on the active session-history entry. */
export function saveCurrentScrollPosition(): void {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
        historyStateWithScroll(window.history.state, { x: window.scrollX, y: window.scrollY }),
        '',
        window.location.href,
    );
}

/** Create state for a newly pushed history entry at the current viewport. */
export function createNavigationHistoryState(): NavigationHistoryState {
    if (typeof window === 'undefined') return {};
    return historyStateWithScroll({}, { x: window.scrollX, y: window.scrollY });
}

/** Read a scroll position previously stored by Cossack from history state. */
export function getSavedScrollPosition(state: unknown): ScrollPosition | undefined {
    if (!isRecord(state)) return undefined;
    const navigationState = state[COSSACK_NAVIGATION_STATE];
    if (!isRecord(navigationState) || !isRecord(navigationState.scroll)) return undefined;
    const { x, y } = navigationState.scroll;
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
}

function scrollToPosition(position: ScrollPosition): void {
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
}

function scrollToUrlTarget(url: string): void {
    const { hash } = new URL(url, window.location.href);
    if (hash) {
        let fragment = hash.slice(1);
        try {
            fragment = decodeURIComponent(fragment);
        } catch {
            // Keep the encoded fragment when it is not valid URI data.
        }

        const target = document.getElementById(fragment)
            ?? document.getElementsByName(fragment)[0];
        if (target) {
            target.scrollIntoView({ block: 'start', behavior: 'instant' });
            return;
        }
    }

    scrollToPosition({ x: 0, y: 0 });
}

/**
 * Apply the configured scroll policy after the destination DOM is committed.
 * Call this from inside a View Transition update callback so its new snapshot
 * contains the destination at the final viewport position.
 */
export function applyNavigationScroll(
    url: string,
    behavior: NavigationScrollBehavior,
    navigationType: NavigationType,
): void {
    if (typeof window === 'undefined' || behavior === 'preserve') return;

    if (behavior === 'auto' && navigationType === 'traverse') {
        const saved = getSavedScrollPosition(window.history.state);
        if (saved) {
            scrollToPosition(saved);
            return;
        }
    }

    if (behavior === 'top') {
        scrollToPosition({ x: 0, y: 0 });
        return;
    }

    scrollToUrlTarget(url);
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

/**
 * Feature-detect the object-form `startViewTransition({ update, types })`
 * (Chrome 125+). The single-argument callback form predates `types`, so
 * passing an object on an older browser throws or is mis-handled — callers
 * must fall back to the callback form (dropping types) when this is false.
 *
 * Detection uses the `:active-view-transition-type()` selector, which ships
 * with the types feature. Cached after the first check.
 */
let _supportsVtTypes: boolean | undefined;
export function supportsViewTransitionTypes(): boolean {
    if (_supportsVtTypes !== undefined) return _supportsVtTypes;
    try {
        _supportsVtTypes =
            typeof CSS !== 'undefined' &&
            typeof CSS.supports === 'function' &&
            CSS.supports('selector(:active-view-transition-type(x))');
    } catch {
        _supportsVtTypes = false;
    }
    return _supportsVtTypes;
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

    const readScrollBehavior = (target: HTMLAnchorElement): NavigationScrollBehavior | undefined => {
        const value = target.dataset.scroll;
        return value === 'auto' || value === 'top' || value === 'preserve'
            ? value
            : undefined;
    };

    // Intercept clicks on links
    const handleClick = async (e: MouseEvent) => {
        // A component may own this link (for example Sidebar.onNavigate).
        // Respecting preventDefault avoids running two SPA navigations for one
        // click. Also preserve standard modified-click browser behaviour.
        if (
            e.defaultPrevented ||
            e.button !== 0 ||
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey
        ) {
            return;
        }

        const target = (e.target as Element).closest('a');
        if (!target || !isLocalLink(target)) return;

        const href = target.getAttribute('href')!;
        e.preventDefault();

        const options: NavigateOptions | undefined = (() => {
            const types = readTransitionTypes(target);
            const scroll = readScrollBehavior(target);
            return types || scroll ? { types, scroll } : undefined;
        })();

        await onNavigate(href, options);
        // The navigation implementation owns pushState so it can create the
        // destination entry before applying its scroll position.
    };
    document.addEventListener('click', handleClick);

    // Pre-fetch on hover
    let prefetchTimeout: any;
    const handleMouseOver = (e: MouseEvent) => {
        const target = (e.target as Element).closest('a');
        if (!target || !isLocalLink(target) || !onPreFetch) return;

        const href = target.getAttribute('href')!;

        // Wait 50ms of hover before prefetching to avoid noise
        clearTimeout(prefetchTimeout);
        prefetchTimeout = setTimeout(() => {
            onPreFetch(href);
        }, 50);
    };
    document.addEventListener('mouseover', handleMouseOver);

    // Handle back/forward buttons.
    // Browser-initiated back/forward navigations carry no transition types.
    // Mark them as traversal so the app can restore the destination entry's
    // saved scroll position after its DOM has been committed.
    const handlePopState = async () => {
        await onNavigate(
            window.location.pathname + window.location.search + window.location.hash,
            { navigationType: 'traverse' },
        );
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
        clearTimeout(prefetchTimeout);
        document.removeEventListener('click', handleClick);
        document.removeEventListener('mouseover', handleMouseOver);
        window.removeEventListener('popstate', handlePopState);
    };
}
