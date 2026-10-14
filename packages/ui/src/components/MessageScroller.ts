import { html, IfDefinedResult, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, Client, ClientState } from '@cossackframework/core';
import type { GlobalAttributes, ButtonAttributes } from '../native-attributes';

export type MessageScrollerViewportProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'>;
export type MessageScrollerJumpProps = Omit<ButtonAttributes, 'type' | 'role' | 'aria-label' | 'aria-labelledby' | 'aria-controls' | 'popovertarget' | 'popovertargetaction'>;
export type MessageScrollerProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & {
    id: string;
    /** Accessible name of the keyboard-scrollable viewport. */
    label: string;
    viewportProps?: MessageScrollerViewportProps;
    jumpProps?: MessageScrollerJumpProps;
    jumpLabel?: string;
    /** Nonnegative finite distance from the bottom in CSS pixels. Default 80. */
    threshold?: number;
    /** Captured when mounted. Default end. Existing browser focus/scroll takes precedence. */
    initialPosition?: 'start' | 'end';
};

type ReadingAnchor = { element: Element; offset: number };
/** Row edges in scroll-content coordinates: viewport-relative top plus scrollTop, so scrolling never changes them. */
type RowBox = { top: number; bottom: number };
function scrollerListener(supplied: unknown, own: (event: Event) => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Native transcript viewport with owned following, visible-element anchoring and cleanup. */
@Component()
export class MessageScroller extends Cossack {
    declare props: MessageScrollerProps;
    @ClientState() private showJump = false;
    private viewport?: HTMLDivElement;
    private content?: HTMLDivElement;
    private jumpButton?: HTMLButtonElement;
    private disposeObservers?: () => void;
    private resizeObserver?: ResizeObserver;
    private observedRows = new Set<Element>();
    private frame?: number;
    private anchorFrame?: number;
    /** scrollTop when anchors were measured. Offsets shift by the scroll since then. */
    private anchorTop = 0;
    private generation = 0;
    private following = true;
    private restoringFocus = false;
    private lastTop = 0;
    private lastMaximum = 0;
    private anchors: ReadingAnchor[] = [];
    /** Row geometry cache. Observed resizes and mutations, and every reconcile, clear it. */
    private boxes = new Map<Element, RowBox>();
    private focusedBeforeRender?: HTMLElement;

    render() {
        // Finish pending geometry reconciliation before the next render can remove
        // our primary anchor. Otherwise a surviving sibling can retain its offset
        // from before a resize even though the reader now sees a different one.
        if (this.frame !== undefined && this.disposeObservers) {
            this.viewport?.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
            this.frame = undefined;
            this.reconcile();
        }
        const { id, label, viewportProps, jumpProps, jumpLabel = 'Scroll to latest messages', threshold = 80, initialPosition = 'end', ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('MessageScroller requires a nonempty id without whitespace.');
        if (typeof label !== 'string' || !label.trim() || typeof jumpLabel !== 'string' || !jumpLabel.trim()) throw new Error('MessageScroller label and jumpLabel must be nonempty.');
        if (!Number.isFinite(threshold) || threshold < 0) throw new Error('MessageScroller threshold must be finite and nonnegative.');
        if (initialPosition !== 'start' && initialPosition !== 'end') throw new Error('MessageScroller initialPosition must be start or end.');
        const focused = this.viewport?.ownerDocument.activeElement;
        if (focused && this.content?.contains(focused)) this.focusedBeforeRender = focused as HTMLElement;
        const { style: viewportStyle, ...nativeViewport } = viewportProps ?? {};
        const suppliedStyle = viewportStyle instanceof IfDefinedResult ? viewportStyle.value : viewportStyle;
        const scrollStyle = `${typeof suppliedStyle === 'string' ? suppliedStyle : ''};overflow-anchor:none;`;
        const attributes = {
            ...nativeViewport,
            '@scroll': scrollerListener(viewportProps?.['@scroll'], () => this.readScroll()),
            '@focusin': scrollerListener(viewportProps?.['@focusin'], event => {
                if (!this.restoringFocus && this.content?.contains(event.target as Node)) { this.following = false; this.remember(); }
            }),
            '@pointerdown': scrollerListener(viewportProps?.['@pointerdown'], () => this.remember()),
            '@wheel': scrollerListener(viewportProps?.['@wheel'], event => {
                const delta = (event as WheelEvent).deltaY;
                if (delta !== 0) { if (delta < 0) this.following = false; this.remember(); }
            }),
            '@keydown': scrollerListener(viewportProps?.['@keydown'], event => {
                const key = event as KeyboardEvent;
                if (key.target === this.viewport && !key.altKey && !key.ctrlKey && !key.metaKey && ['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '].includes(key.key)) {
                    if (key.key === 'Home') {
                        key.preventDefault();
                        this.following = false;
                        this.viewport.scrollTo({ top: 0, behavior: 'instant' });
                        this.remember(); this.updateJump();
                        return;
                    }
                    if (['Home', 'PageUp', 'ArrowUp'].includes(key.key) || (key.key === ' ' && key.shiftKey)) this.following = false;
                    this.remember();
                }
            }),
        };
        return html`<div class="cs-message-scroller relative h-full min-h-0 min-w-0" ...=${rest} id=${id}>
            <div class="cs-message-scroller__viewport h-full overflow-y-auto min-w-0 focus-visible:ring-2 focus-visible:ring-ring"
                ...=${attributes} style=${scrollStyle} id=${`${id}-viewport`} role="region" aria-label=${label} tabindex="0"
                ref=${(element: Element) => this.connect(element as HTMLDivElement)}>
                <div class="cs-message-scroller__content flex flex-col gap-3 p-4 min-w-0" ref=${(element: Element) => { this.content = element as HTMLDivElement; }}>${this.children}</div>
            </div>
            ${this.showJump ? html`<button
                class="cs-message-scroller__jump absolute bottom-4 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 max-w-[calc(100%-2rem)] px-3 py-1.5 text-sm font-medium rounded-full bg-popover text-popover-foreground border shadow-lg cursor-pointer hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed z-10"
                ...=${{ ...jumpProps, '@click': scrollerListener(jumpProps?.['@click'], event => { if (!(event.currentTarget as HTMLButtonElement).matches(':disabled')) this.scrollToBottom(); }) }}
                type="button" aria-controls=${`${id}-viewport`} ref=${(element: Element) => { this.jumpButton = element as HTMLButtonElement; }}>${jumpLabel}</button>` : null}
        </div>`;
    }
    private innerTop() { return this.viewport!.getBoundingClientRect().top + this.viewport!.clientTop; }
    private rows() { return Array.from(this.content?.children ?? []); }
    private distance() { const vp = this.viewport!; return Math.max(0, vp.scrollHeight - vp.clientHeight - vp.scrollTop); }
    /** Record the reading position. Scroll metrics are cheap and recorded now; rows are measured once per frame. */
    private remember() {
        const vp = this.viewport;
        if (!vp?.isConnected || !vp.clientHeight) return;
        this.lastTop = vp.scrollTop;
        this.lastMaximum = Math.max(0, vp.scrollHeight - vp.clientHeight);
        const window = vp.ownerDocument.defaultView;
        if (!window) { this.measureAnchors(); return; }
        this.anchorFrame ??= window.requestAnimationFrame(() => { this.anchorFrame = undefined; this.measureAnchors(); });
    }
    /** Drop cached row geometry and reconcile on the next frame. */
    private geometryChanged() { this.boxes.clear(); this.schedule(); }
    private measureAnchors() {
        const vp = this.viewport;
        if (this.anchorFrame !== undefined) { vp?.ownerDocument.defaultView?.cancelAnimationFrame(this.anchorFrame); this.anchorFrame = undefined; }
        if (!vp?.isConnected || !vp.clientHeight) return;
        // Work in scroll-content coordinates: a scroll moves the viewport window,
        // not the cached rows, so only rows never measured since the last geometry change are read.
        const scrollTop = vp.scrollTop, top = scrollTop, bottom = top + vp.clientHeight, rows = this.rows();
        let origin: number | undefined;
        const box = (element: Element): RowBox => {
            let cached = this.boxes.get(element);
            if (!cached) {
                origin ??= this.innerTop() - scrollTop;
                const rect = element.getBoundingClientRect();
                cached = { top: rect.top - origin, bottom: rect.bottom - origin };
                this.boxes.set(element, cached);
            }
            return cached;
        };
        const measure = (from: number) => {
            const anchors: ReadingAnchor[] = [];
            for (let index = from; index < rows.length; index++) {
                const rect = box(rows[index]);
                if (rect.bottom - rect.top <= 0) continue;
                if (rect.top >= bottom) break;
                if (rect.bottom > top) anchors.push({ element: rows[index], offset: rect.top - top });
            }
            return anchors;
        };
        // Rows stack in DOM order, so binary-search the first row that ends
        // below the viewport top. Empty (hidden) rows defer to the next row.
        let low = 0, high = rows.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            let probe = middle, rect = box(rows[probe]);
            while (rect.bottom - rect.top <= 0 && probe + 1 < high) rect = box(rows[++probe]);
            if (rect.bottom - rect.top <= 0 || rect.bottom > top) high = middle;
            else low = probe + 1;
        }
        let anchors = measure(low);
        // Content laid out out of DOM order (CSS order, reversed flex): scan everything.
        if (!anchors.length && rows.length) anchors = rows.flatMap(element => {
            const rect = box(element);
            return rect.bottom - rect.top > 0 && rect.bottom > top && rect.top < bottom ? [{ element, offset: rect.top - top }] : [];
        });
        this.anchors = anchors;
        this.anchorTop = scrollTop;
    }
    private updateJump() {
        if (!this.viewport?.isConnected) return;
        const visible = this.distance() > (this.props.threshold ?? 80);
        if (!visible && this.jumpButton === this.viewport.ownerDocument.activeElement) this.viewport.focus({ preventScroll: true });
        this.showJump = visible;
    }
    private readScroll() {
        const vp = this.viewport;
        if (!this.disposeObservers || !vp?.isConnected || Math.abs(vp.scrollTop - this.lastTop) < 0.5) return;
        // Geometry can clamp scrollTop without a user choosing to follow.
        // Pointer/key/focus intent records current geometry before native scrolling.
        if (Math.abs(Math.max(0, vp.scrollHeight - vp.clientHeight) - this.lastMaximum) > 0.5) { this.schedule(); return; }
        // An explicit upward scroll pauses following even inside the threshold.
        // Resume near the bottom only when the reader scrolls toward it.
        this.following = this.distance() <= (this.props.threshold ?? 80)
            && (this.following || vp.scrollTop > this.lastTop || this.distance() < 0.5);
        this.remember(); this.updateJump();
    }
    private schedule() {
        const window = this.viewport?.ownerDocument.defaultView;
        if (!this.disposeObservers || !window || this.frame !== undefined) return;
        this.frame = window.requestAnimationFrame(() => { this.frame = undefined; this.reconcile(); });
    }
    private reconcile() {
        const vp = this.viewport, content = this.content;
        if (!this.disposeObservers || !vp?.isConnected || !content || !vp.clientHeight) return;
        this.boxes.clear();
        const rows = new Set(this.rows());
        for (const row of this.observedRows) if (!rows.has(row)) { this.resizeObserver?.unobserve(row); this.observedRows.delete(row); }
        for (const row of rows) if (!this.observedRows.has(row)) { this.resizeObserver?.observe(row); this.observedRows.add(row); }
        if (this.following) vp.scrollTo({ top: vp.scrollHeight, behavior: 'instant' });
        else {
            const anchor = this.anchors.find(item => content.contains(item.element) && item.element.getBoundingClientRect().height > 0);
            // Anchors can be up to a frame old; the reader has since scrolled from anchorTop to lastTop.
            const offset = anchor ? anchor.offset + this.anchorTop - this.lastTop : 0;
            const top = anchor ? vp.scrollTop + anchor.element.getBoundingClientRect().top - this.innerTop() - offset : this.lastTop;
            vp.scrollTo({ top, behavior: 'instant' });
        }
        // Geometry just changed, so the next reconcile needs fresh anchors now.
        this.remember(); this.measureAnchors(); this.updateJump();
    }
    private connect(viewport: HTMLDivElement) {
        this.viewport = viewport;
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || this.viewport !== viewport || !viewport.isConnected || !this.content?.isConnected) return;
            if (!this.disposeObservers) {
                this.following = (this.props.initialPosition ?? 'end') === 'end' && viewport.scrollTop === 0 && !viewport.contains(viewport.ownerDocument.activeElement);
                this.remember();
                const resize = new ResizeObserver(() => this.geometryChanged()); this.resizeObserver = resize;
                resize.observe(viewport); resize.observe(this.content);
                const mutations = new MutationObserver(() => this.geometryChanged());
                mutations.observe(this.content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
                // Finished transforms and transitions move rows without resizing them.
                const moved = () => this.boxes.clear(), content = this.content;
                for (const type of ['transitionend', 'animationend'] as const) content.addEventListener(type, moved);
                this.disposeObservers = () => {
                    resize.disconnect(); mutations.disconnect();
                    for (const type of ['transitionend', 'animationend'] as const) content.removeEventListener(type, moved);
                };
            }
            const old = this.focusedBeforeRender; this.focusedBeforeRender = undefined;
            if (old && (viewport.ownerDocument.activeElement === old || viewport.ownerDocument.activeElement === viewport.ownerDocument.body)) {
                const target = old.isConnected && old.getClientRects().length && !old.matches(':disabled') && !old.closest('[hidden],[inert]') ? old : viewport;
                this.restoringFocus = true;
                try {
                    target.focus({ preventScroll: true });
                    if (viewport.ownerDocument.activeElement === viewport.ownerDocument.body) viewport.focus({ preventScroll: true });
                } finally { this.restoringFocus = false; }
            }
            this.schedule();
        });
    }
    /** Follow the latest content. Disconnected calls are harmless. */
    @Client()
    scrollToBottom() {
        const vp = this.viewport;
        if (!this.disposeObservers || !vp?.isConnected) return;
        this.following = true; vp.scrollTo({ top: vp.scrollHeight, behavior: 'instant' });
        const focused = vp.ownerDocument.activeElement;
        if (focused && this.content?.contains(focused)) {
            const rect = focused.getBoundingClientRect(), top = this.innerTop();
            if (rect.top < top || rect.bottom > top + vp.clientHeight) vp.focus({ preventScroll: true });
        }
        this.remember(); this.updateJump();
    }
    onCleanup() {
        this.generation++;
        if (this.frame !== undefined) this.viewport?.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
        if (this.anchorFrame !== undefined) this.viewport?.ownerDocument.defaultView?.cancelAnimationFrame(this.anchorFrame);
        this.frame = undefined; this.anchorFrame = undefined; this.disposeObservers?.(); this.disposeObservers = undefined; this.resizeObserver = undefined;
        this.observedRows.clear(); this.anchors = []; this.boxes.clear(); this.viewport = undefined; this.content = undefined; this.jumpButton = undefined; this.focusedBeforeRender = undefined;
    }
}
