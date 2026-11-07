/**
 * The browser's part of a carousel block: arrows and dots move the scroll-snapping track, the
 * arrow keys do the same when it has focus, and autoplay advances it until it is hovered,
 * focused or hidden. Without this the track still scrolls and swipes.
 */
const enhanced = new WeakSet<HTMLElement>();

export function enhanceCarousel(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    const track = root.querySelector<HTMLElement>('.cms-carousel-track');
    const slides = [...root.querySelectorAll<HTMLElement>('.cms-carousel-slide')];
    const dots = [...root.querySelectorAll<HTMLButtonElement>('.cms-carousel-dots [role="tab"]')];
    if (!track || slides.length < 2) return;
    root.setAttribute('data-enhanced', '');
    let current = 0;
    const show = (index: number) => {
        current = (index + slides.length) % slides.length;
        track.scrollTo({ left: slides[current]!.offsetLeft - track.offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const mark = () => {
        const width = track.clientWidth || 1;
        current = Math.round(track.scrollLeft / width);
        dots.forEach((dot, index) => dot.setAttribute('aria-selected', index === current ? 'true' : 'false'));
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
