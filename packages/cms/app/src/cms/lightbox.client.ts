/**
 * The browser's part of a lightbox: a click on a link marked `data-cms-lightbox` ("image" or
 * "video") opens the file large in one dialog over the page, with arrows to the other links of
 * the same block. Escape, the close button and a click outside the file close it. Without this
 * the links open the files themselves.
 */
const enhanced = new WeakSet<HTMLElement>();

interface Item { readonly kind: 'image' | 'video'; readonly src: string; readonly alt: string; readonly caption: string }

interface Lightbox {
    readonly dialog: HTMLDialogElement;
    readonly stage: HTMLElement;
    readonly caption: HTMLElement;
    readonly previous: HTMLButtonElement;
    readonly next: HTMLButtonElement;
    items: readonly Item[];
    index: number;
}

let lightbox: Lightbox | undefined;

function button(className: string, label: string, path: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);
    element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
    return element;
}

/** The page's one dialog, made when the first lightbox opens. */
function shared(labels: { close: string; previous: string; next: string }): Lightbox {
    if (lightbox?.dialog.isConnected) return lightbox;
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-lightbox';
    const stage = document.createElement('div');
    stage.className = 'cms-lightbox-stage';
    const caption = document.createElement('p');
    caption.className = 'cms-lightbox-caption';
    const close = button('cms-lightbox-close', labels.close, 'M6 18L18 6M6 6l12 12');
    const previous = button('cms-lightbox-arrow cms-lightbox-prev', labels.previous, 'M15 19l-7-7 7-7');
    const next = button('cms-lightbox-arrow cms-lightbox-next', labels.next, 'M9 5l7 7-7 7');
    // appendChild, not append: in a Workers application `append` is typed as HTMLRewriter's.
    for (const part of [close, previous, stage, next, caption]) dialog.appendChild(part);
    document.body.appendChild(dialog);
    const created: Lightbox = { dialog, stage, caption, previous, next, items: [], index: 0 };
    close.addEventListener('click', () => dialog.close());
    previous.addEventListener('click', () => show(created, created.index - 1));
    next.addEventListener('click', () => show(created, created.index + 1));
    // A click on the dark ground, not on the file or a button, closes.
    dialog.addEventListener('click', event => { if (event.target === dialog || event.target === stage) dialog.close(); });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight') show(created, created.index + 1);
        if (event.key === 'ArrowLeft') show(created, created.index - 1);
    });
    // Closing stops a playing video and lets the page scroll again.
    dialog.addEventListener('close', () => { stage.replaceChildren(); document.documentElement.style.removeProperty('overflow'); });
    lightbox = created;
    return created;
}

function show(box: Lightbox, index: number): void {
    const count = box.items.length;
    if (!count) return;
    box.index = (index + count) % count;
    const item = box.items[box.index]!;
    let media: HTMLElement;
    if (item.kind === 'video') {
        const video = document.createElement('video');
        video.src = item.src;
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        media = video;
    } else {
        const image = document.createElement('img');
        image.src = item.src;
        image.alt = item.alt;
        media = image;
    }
    media.className = 'cms-lightbox-media';
    box.stage.replaceChildren(media);
    box.caption.textContent = item.caption;
    box.caption.hidden = !item.caption;
    box.previous.hidden = box.next.hidden = count < 2;
}

export function enhanceLightbox(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    root.addEventListener('click', event => {
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-cms-lightbox]');
        // A modified click keeps its meaning: a new tab, a download.
        if (!link || !root.contains(link) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (typeof HTMLDialogElement === 'undefined') return;
        event.preventDefault();
        // The links are read at the click, so a block that changed since still opens what it shows.
        const links = [...root.querySelectorAll<HTMLAnchorElement>('a[data-cms-lightbox]')];
        const box = shared({ close: root.dataset.closeLabel ?? 'Close', previous: root.dataset.previousLabel ?? 'Previous', next: root.dataset.nextLabel ?? 'Next' });
        box.items = links.map(entry => ({
            kind: entry.dataset.cmsLightbox === 'video' ? 'video' : 'image', src: entry.href,
            alt: entry.querySelector('img')?.alt ?? '', caption: entry.dataset.caption ?? '',
        }));
        show(box, Math.max(links.indexOf(link), 0));
        document.documentElement.style.overflow = 'hidden';
        if (!box.dialog.open) box.dialog.showModal();
    });
}
