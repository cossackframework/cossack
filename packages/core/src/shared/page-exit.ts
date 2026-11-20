/**
 * Whether the browser is leaving the page. A request the browser cuts off then is a
 * cancellation, not a failure: the page is gone, so nothing logs it as an error.
 *
 * `pagehide` covers every browser; the Navigation API's `navigate` event also marks a
 * navigation to another document as it starts, before Firefox fails the page's requests.
 * Neither keeps the page out of the back/forward cache, unlike `beforeunload`. A navigation
 * that does not happen (a download, a 204 answer) stops counting after ten seconds, and a
 * page restored from the cache stops counting at once.
 */
const STAY_MS = 10_000;
let leavingAt: number | undefined;
let watching = false;

/** Start watching for the page leaving; called before the first request. Browser only. */
export function watchPageExit(): void {
    if (watching || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    watching = true;
    const leave = () => { leavingAt = Date.now(); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', () => { leavingAt = undefined; });
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    navigation?.addEventListener?.('navigate', event => {
        const navigate = event as Event & { destination?: { sameDocument?: boolean }; downloadRequest?: string | null };
        if (navigate.destination?.sameDocument === false && !navigate.downloadRequest) leave();
    });
}

/** True while the page is leaving. */
export function isLeavingPage(): boolean {
    return leavingAt !== undefined && Date.now() - leavingAt < STAY_MS;
}

/** @internal Tests: forget the state. */
export function resetPageExit(): void {
    leavingAt = undefined;
}
