/**
 * The browser's part of share buttons: the copy button puts the page's address on the
 * clipboard and says so for a moment; the links open their networks in a small window.
 */
const enhanced = new WeakSet<HTMLElement>();

export function enhanceShare(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-network="copy"]')) {
        button.addEventListener('click', async () => {
            const url = button.dataset.url || location.href;
            try {
                await navigator.clipboard.writeText(url);
                button.setAttribute('data-copied', '');
                setTimeout(() => button.removeAttribute('data-copied'), 2000);
            } catch { /* the clipboard is unavailable: the address stays in the bar */ }
        });
    }
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-network][target="_blank"]')) {
        link.addEventListener('click', event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
            const popup = window.open(link.href, 'cms-share', 'width=640,height=560,noopener,noreferrer');
            if (popup) event.preventDefault();
        });
    }
}
