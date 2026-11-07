/**
 * The browser's part of a tabs block: the tab buttons show their panel, the arrow keys, Home and
 * End move between them, and a link to a panel's id opens its tab. Without this every panel shows
 * under its title, so the content is never out of reach.
 */
const enhanced = new WeakSet<HTMLElement>();

export function enhanceTabs(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>(':scope > .cms-tablist > [role="tab"]')];
    const panels = [...root.querySelectorAll<HTMLElement>(':scope > .cms-tabpanel')];
    if (!tabs.length || tabs.length !== panels.length) return;
    root.setAttribute('data-enhanced', '');
    const select = (index: number, focus: boolean) => {
        tabs.forEach((tab, at) => { tab.setAttribute('aria-selected', at === index ? 'true' : 'false'); tab.tabIndex = at === index ? 0 : -1; });
        panels.forEach((panel, at) => { if (at === index) panel.setAttribute('data-active', ''); else panel.removeAttribute('data-active'); });
        if (focus) tabs[index]?.focus();
    };
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(index, false));
        tab.addEventListener('keydown', event => {
            const moves: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 };
            const next = moves[event.key];
            if (next === undefined) return;
            event.preventDefault();
            select((next + tabs.length) % tabs.length, true);
        });
    });
    const open = () => {
        const index = panels.findIndex(panel => panel.id && panel.id === decodeURIComponent(location.hash.slice(1)));
        if (index >= 0) select(index, false);
    };
    open();
    addEventListener('hashchange', open);
}
