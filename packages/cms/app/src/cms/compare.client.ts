/**
 * The browser's part of a before-and-after block: the range input over each pair moves the
 * handle (pointer, touch and arrow keys), a mouse moving over the pair moves it too, and the
 * thumbnails pick the pair shown. Without this every pair shows, split where it starts.
 */
const enhanced = new WeakSet<HTMLElement>();

export function enhanceCompare(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    root.setAttribute('data-enhanced', '');
    const pairs = [...root.querySelectorAll<HTMLElement>(':scope > .cms-compare-pair')];
    const thumbs = [...root.querySelectorAll<HTMLButtonElement>(':scope > .cms-compare-thumbs > [role="tab"]')];
    for (const stage of root.querySelectorAll<HTMLElement>('.cms-compare-stage')) {
        const range = stage.querySelector<HTMLInputElement>('.cms-compare-range');
        if (!range) continue;
        const set = (percent: number) => {
            const value = Math.min(Math.max(percent, 0), 100);
            stage.style.setProperty('--cms-compare', `${value}%`);
            range.value = String(Math.round(value));
        };
        range.addEventListener('input', () => set(Number(range.value)));
        // A mouse reveals as it moves, with no press; touch and pen drag the range.
        stage.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse') return;
            const box = stage.getBoundingClientRect();
            if (box.width) set(((event.clientX - box.left) / box.width) * 100);
        });
    }
    if (thumbs.length !== pairs.length || pairs.length < 2) return;
    const select = (index: number) => {
        pairs.forEach((pair, at) => { if (at === index) pair.setAttribute('data-active', ''); else pair.removeAttribute('data-active'); });
        thumbs.forEach((thumb, at) => { thumb.setAttribute('aria-selected', at === index ? 'true' : 'false'); thumb.tabIndex = at === index ? 0 : -1; });
    };
    thumbs.forEach((thumb, index) => {
        thumb.addEventListener('click', () => select(index));
        thumb.addEventListener('keydown', event => {
            const to = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : -1;
            if (to < 0 || to >= thumbs.length) return;
            event.preventDefault();
            select(to);
            thumbs[to]!.focus();
            thumbs[to]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    });
    select(0);
}
