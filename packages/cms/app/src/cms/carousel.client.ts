/**
 * The browser's part of a carousel block: arrows and dots (or thumbnails) move the
 * scroll-snapping track, the arrow keys do the same when it has focus, and autoplay advances it
 * until it is hovered, focused or hidden. Several slides may show at once; the track then moves
 * one slide at a time and stops at the last full view. Without this the track still scrolls and swipes.
 */
const enhanced = new WeakSet<HTMLElement>();

export function enhanceCarousel(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    const track = root.querySelector<HTMLElement>('.cms-carousel-track');
    const slides = [...root.querySelectorAll<HTMLElement>('.cms-carousel-slide')];
    const dots = [...root.querySelectorAll<HTMLButtonElement>('.cms-carousel-dots [role="tab"], .cms-carousel-thumbs [role="tab"]')];
    if (!track || slides.length < 2) return;
    root.setAttribute('data-enhanced', '');
    let current = 0;
    // The first slide of the last full view: with three showing of five, the track stops at the third.
    const step = () => (slides[1]!.offsetLeft - slides[0]!.offsetLeft) || track.clientWidth || 1;
    const last = () => Math.max(slides.length - Math.max(Math.round(track.clientWidth / step()), 1), 0);
    const show = (index: number) => {
        const end = last();
        current = index > end ? 0 : index < 0 ? end : index;
        track.scrollTo({ left: slides[current]!.offsetLeft - slides[0]!.offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const mark = () => {
        current = Math.min(Math.round(track.scrollLeft / step()), slides.length - 1);
        dots.forEach((dot, index) => {
            dot.setAttribute('aria-selected', index === current ? 'true' : 'false');
            // A thumbnail strip follows the slide shown.
            if (index === current && dot.classList.contains('cms-carousel-thumb')) dot.parentElement?.scrollTo({ left: dot.offsetLeft - dot.parentElement.clientWidth / 2 + dot.clientWidth / 2, behavior: 'smooth' });
        });
    };
    track.addEventListener('scroll', mark, { passive: true });
    for (const arrow of root.querySelectorAll<HTMLButtonElement>('.cms-carousel-arrow')) arrow.addEventListener('click', () => show(current + Number(arrow.dataset.direction || 1)));
    dots.forEach((dot, index) => dot.addEventListener('click', () => show(index)));
    track.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
    });
    // Autoplay: every interval, unless the pointer or the focus is on the carousel, or the page is hidden.
    if (root.dataset.autoplay !== 'true') return;
    const interval = Math.min(Math.max(Number(root.dataset.interval) || 5, 2), 30) * 1000;
    let paused = false;
    root.addEventListener('pointerenter', () => { paused = true; });
    root.addEventListener('pointerleave', () => { paused = false; });
    root.addEventListener('focusin', () => { paused = true; });
    root.addEventListener('focusout', () => { paused = false; });
    const timer = setInterval(() => { if (!paused && !document.hidden && root.isConnected) show(current + 1); }, interval);
    const observer = new MutationObserver(() => { if (!root.isConnected) { clearInterval(timer); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
}
