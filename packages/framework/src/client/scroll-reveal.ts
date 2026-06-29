/**
 * Robust scroll-reveal primitive.
 *
 * Reveals elements matching a selector (default `.scroll-reveal`) by adding a
 * class (default `.revealed`) when they scroll into view. Unlike a one-shot
 * `IntersectionObserver` setup, this also watches the DOM for elements added
 * later (tab switches, filters, modals, async content) and reveals them too —
 * so newly-rendered `.scroll-reveal` nodes never get stuck invisible.
 *
 * Usage (in your global `App` component):
 *
 * ```ts
 * onMount() {
 *   this._cleanupReveal = setupScrollReveal();
 * }
 * onCleanup() {
 *   this._cleanupReveal?.();
 * }
 * ```
 *
 * Returns a cleanup function that disconnects both observers.
 */
export interface ScrollRevealOptions {
  /** Selector for elements to reveal. Defaults to `.scroll-reveal`. */
  selector?: string;
  /** Class added once an element enters the viewport. Defaults to `revealed`. */
  revealedClass?: string;
  /** IntersectionObserver threshold. Defaults to `0.1`. */
  threshold?: number;
  /** IntersectionObserver rootMargin. Defaults to `0px 0px -50px 0px`. */
  rootMargin?: string;
  /** Reveal only once (default). When `false`, the class is toggled on leave. */
  once?: boolean;
  /** IntersectionObserver root. Defaults to the viewport. */
  root?: Element | null;
}

export function setupScrollReveal(options: ScrollRevealOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // SSR / non-DOM: no-op.
    return () => {};
  }

  const {
    selector = '.scroll-reveal',
    revealedClass = 'revealed',
    threshold = 0.1,
    rootMargin = '0px 0px -50px 0px',
    once = true,
    root = null,
  } = options;

  const observed = new WeakSet<Element>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add(revealedClass);
          if (once) io.unobserve(entry.target);
        } else if (!once) {
          entry.target.classList.remove(revealedClass);
        }
      }
    },
    { threshold, rootMargin, root },
  );

  const observe = (el: Element) => {
    if (observed.has(el)) return;
    observed.add(el);
    io.observe(el);
  };

  const scan = () => {
    document.querySelectorAll(`${selector}:not(.${revealedClass})`).forEach(observe);
  };

  scan();

  // Watch for dynamically-added nodes (tab/filter/modal content) and observe
  // any that match the selector.
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (typeof el.matches === 'function' && el.matches(selector)) observe(el);
        if (typeof el.querySelectorAll === 'function') {
          el.querySelectorAll(selector).forEach(observe);
        }
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Re-scan after soft navigation (Cossack dispatches `cossack:ready`).
  const onReady = () => scan();
  document.addEventListener('cossack:ready', onReady);

  return () => {
    io.disconnect();
    mo.disconnect();
    document.removeEventListener('cossack:ready', onReady);
  };
}
