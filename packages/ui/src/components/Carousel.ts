import { html, component, repeat, IfDefinedResult, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, Client, ClientState } from '@cossackframework/core';
import { Icon } from '../icons/Icon';
import { AltArrowLeftIcon } from '@cossackframework/solar-icons/alt-arrow-left';
import { AltArrowRightIcon } from '@cossackframework/solar-icons/alt-arrow-right';
import type { GlobalAttributes } from '../native-attributes';

export type CarouselSlideProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'aria-label' | 'aria-labelledby'>;
export interface CarouselSlide { value: string; label: string; content: unknown; size?: string; props?: CarouselSlideProps; }
export type CarouselViewportProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'>;
export type CarouselProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'aria-label' | 'aria-labelledby'> & {
    id: string;
    label: string;
    slides: readonly CarouselSlide[];
    /** CSS flex-basis for each slide. Defaults to 100%; individual slides can override size. */
    slideSize?: string;
    viewportProps?: CarouselViewportProps;
    viewportLabel?: string;
    previousLabel?: string;
    nextLabel?: string;
    emptyLabel?: string;
    /** Reports the settled visible slide, including undefined after the list becomes empty. */
    onValueChange?: (value: string | undefined) => unknown;
};

function carouselListener(supplied: unknown, own: (event: Event) => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Native scroll-snap slides with explicit identity, names and browser-owned content. */
@Component()
export class Carousel extends Cossack {
    declare props: CarouselProps;
    @ClientState() private activeValue?: string;
    @ClientState() private requestedValue?: string;
    @ClientState() private announcement = '';
    @ClientState() private atStart = true;
    @ClientState() private atEnd = false;
    private viewport?: HTMLDivElement;
    private cleanup?: () => void;
    private resizeObserver?: ResizeObserver;
    private observedSlides = new Set<Element>();
    private settleTimer?: ReturnType<typeof setTimeout>;
    private frame?: number;
    private generation = 0;
    private lastIndex = 0;
    private notifiedValue?: string;
    private initialized = false;
    private signature = '';
    private direction = '';
    private focusedBeforeRender?: HTMLElement;

    private index(value = this.activeValue) {
        const index = this.props.slides.findIndex(slide => slide.value === value);
        return index < 0 ? Math.min(this.lastIndex, this.props.slides.length - 1) : index;
    }
    private validate() {
        const p = this.props;
        if (typeof p.id !== 'string' || !p.id || /\s/.test(p.id)) throw new Error('Carousel requires a nonempty id without whitespace.');
        for (const name of ['label', 'viewportLabel', 'previousLabel', 'nextLabel', 'emptyLabel', 'slideSize'] as const) {
            if ((name === 'label' || p[name] !== undefined) && (typeof p[name] !== 'string' || !p[name]?.trim())) throw new Error(`Carousel ${name} must be nonempty.`);
        }
        if (!Array.isArray(p.slides)) throw new Error('Carousel requires a slides array.');
        const values = new Set<string>();
        for (const slide of p.slides) {
            if (!slide || typeof slide.value !== 'string' || !slide.value.trim() || values.has(slide.value)) throw new Error('Carousel slide values must be nonempty and unique.');
            if (typeof slide.label !== 'string' || !slide.label.trim() || !Object.hasOwn(slide, 'content')) throw new Error('Carousel slides require label and content.');
            if (slide.size !== undefined && (typeof slide.size !== 'string' || !slide.size.trim())) throw new Error('Carousel slide size must be a nonempty CSS length.');
            values.add(slide.value);
        }
        if (p.onValueChange !== undefined && typeof p.onValueChange !== 'function') throw new Error('Carousel onValueChange must be a function.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Carousel uses slides, not component children.');
    }
    render() {
        this.validate();
        const { id, label, slides, slideSize: _size, viewportProps, viewportLabel = 'Slides', previousLabel = 'Previous slide', nextLabel = 'Next slide', emptyLabel = 'No slides', onValueChange: _change,
            'aria-roledescription': description = 'carousel', ...rest } = this.props;
        const active = this.viewport?.ownerDocument.activeElement;
        if (active && this.viewport?.contains(active)) this.focusedBeforeRender = active as HTMLElement;
        const index = this.index(this.requestedValue ?? this.activeValue);
        const viewportAttributes = {
            ...viewportProps,
            '@scroll': carouselListener(viewportProps?.['@scroll'], () => { if (this.cleanup) { this.record(this.nearest()); this.settle(); } }),
            '@keydown': carouselListener(viewportProps?.['@keydown'], event => this.viewportKeydown(event as KeyboardEvent)),
            '@focusin': carouselListener(viewportProps?.['@focusin'], event => this.viewportFocus(event as FocusEvent)),
            '@pointerdown': carouselListener(viewportProps?.['@pointerdown'], () => this.interrupt()),
            '@wheel': carouselListener(viewportProps?.['@wheel'], () => this.interrupt()),
        };
        return html`<div class="cs-carousel relative w-full min-w-0" ...=${rest} id=${id} role="region" aria-label=${label} aria-roledescription=${description}>
            <div class="cs-carousel__controls flex justify-end gap-2 mb-2">
                <button type="button" class="cs-carousel__prev size-9 rounded-full border inline-flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50"
                    aria-label=${previousLabel} aria-controls=${`${id}-viewport`} aria-disabled=${index <= 0 || (this.requestedValue === undefined && this.atStart)} @click=${() => this.scrollPrev()}><span aria-hidden="true" class="rtl:rotate-180">${component(Icon, { entry: AltArrowLeftIcon, size: 16 })}</span></button>
                <button type="button" class="cs-carousel__next size-9 rounded-full border inline-flex items-center justify-center focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50"
                    aria-label=${nextLabel} aria-controls=${`${id}-viewport`} aria-disabled=${index < 0 || index >= slides.length - 1 || (this.requestedValue === undefined && this.atEnd)} @click=${() => this.scrollNext()}><span aria-hidden="true" class="rtl:rotate-180">${component(Icon, { entry: AltArrowRightIcon, size: 16 })}</span></button>
            </div>
            <div class="cs-carousel__viewport flex overflow-x-auto snap-x snap-mandatory min-w-0 focus-visible:ring-2 focus-visible:ring-ring" ...=${viewportAttributes}
                id=${`${id}-viewport`} role="group" aria-label=${viewportLabel} tabindex="0" ref=${(element: Element) => this.connect(element as HTMLDivElement)}>
                ${repeat(slides, slide => slide.value, slide => this.renderSlide(slide))}
            </div>
            ${slides.length ? null : html`<p class="cs-carousel__empty">${emptyLabel}</p>`}
            <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.announcement}</div>
        </div>`;
    }
    private renderSlide(slide: CarouselSlide) {
        const { 'aria-roledescription': description = 'slide', style, ...props } = slide.props ?? {};
        const supplied = style instanceof IfDefinedResult ? style.value : style;
        const dimensions = `flex:0 0 ${slide.size ?? this.props.slideSize ?? '100%'};min-width:0;${typeof supplied === 'string' ? supplied : ''}`;
        return html`<div class="cs-carousel__slide snap-start" style=${dimensions} ...=${props} id=${`${this.props.id}-slide-${encodeURIComponent(slide.value)}`}
            data-carousel-value=${slide.value} role="group" aria-label=${slide.label} aria-roledescription=${description}>${slide.content}</div>`;
    }
    private elements() { return Array.from(this.viewport?.querySelectorAll<HTMLDivElement>(':scope > [data-carousel-value]') ?? []); }
    private position() {
        const viewport = this.viewport, first = this.elements()[0];
        if (!viewport || !first) return 0;
        const bounds = viewport.getBoundingClientRect(), rect = first.getBoundingClientRect();
        const rtl = viewport.ownerDocument.defaultView!.getComputedStyle(viewport).direction === 'rtl';
        return rtl ? rect.right - bounds.right + viewport.clientLeft : bounds.left - rect.left + viewport.clientLeft;
    }
    private nearest() {
        const viewport = this.viewport;
        if (!viewport || !viewport.clientWidth) return this.index();
        const elements = this.elements();
        if (!elements.length) return -1;
        const maximum = viewport.scrollWidth - viewport.clientWidth;
        if (maximum <= 1) return 0;
        if (maximum - this.position() <= 1) return elements.length - 1;
        const bounds = viewport.getBoundingClientRect(), rtl = viewport.ownerDocument.defaultView!.getComputedStyle(viewport).direction === 'rtl';
        let best = -1, distance = Infinity;
        elements.forEach((element, index) => {
            const rect = element.getBoundingClientRect(), delta = Math.abs(rtl ? rect.right - bounds.right + viewport.clientLeft : rect.left - bounds.left - viewport.clientLeft);
            if (delta < distance) { best = index; distance = delta; }
        });
        return best;
    }
    private record(index: number) {
        this.lastIndex = Math.max(0, index);
        this.activeValue = this.props.slides[index]?.value;
        const viewport = this.viewport, first = this.elements()[0];
        if (viewport?.clientWidth && first) {
            const position = this.position();
            this.atStart = position <= 1;
            this.atEnd = viewport.scrollWidth - viewport.clientWidth - position <= 1;
        } else { this.atStart = true; this.atEnd = this.props.slides.length < 2; }
    }
    private fullyVisible(element: Element) {
        const viewport = this.viewport!.getBoundingClientRect(), rect = element.getBoundingClientRect();
        return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1;
    }
    private finish() {
        if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
        this.settleTimer = undefined;
        if (!this.viewport?.isConnected) return;
        const index = this.nearest(); this.requestedValue = undefined; this.record(index);
        const slide = this.props.slides[index];
        const focused = this.viewport.ownerDocument.activeElement;
        if (focused && focused !== this.viewport && this.viewport.contains(focused) && !this.fullyVisible(focused)) this.viewport.focus({ preventScroll: true });
        this.announcement = slide ? `${index + 1} / ${this.props.slides.length}: ${slide.label}` : this.props.emptyLabel ?? 'No slides';
        if (this.notifiedValue !== slide?.value) { this.notifiedValue = slide?.value; this.props.onValueChange?.(slide?.value); }
    }
    private settle() {
        if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.finish(), 140);
    }
    private align(index: number, smooth: boolean) {
        const viewport = this.viewport, element = this.elements()[index];
        if (!viewport?.isConnected || !viewport.clientWidth || !element) return;
        const window = viewport.ownerDocument.defaultView!, rtl = window.getComputedStyle(viewport).direction === 'rtl';
        const vp = viewport.getBoundingClientRect(), slide = element.getBoundingClientRect();
        const delta = rtl ? slide.right - vp.right + viewport.clientLeft : slide.left - vp.left - viewport.clientLeft;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        viewport.scrollBy({ left: delta, behavior: smooth && !reduced ? 'smooth' : 'instant' });
    }
    @Client()
    scrollToSlide(value: string) {
        const index = this.props.slides.findIndex(slide => slide.value === value);
        if (index < 0) throw new Error('Carousel scrollToSlide requires an existing slide value.');
        this.move(index);
    }
    @Client() scrollNext() { if (this.requestedValue !== undefined || !this.atEnd) this.move(this.index(this.requestedValue) + 1); }
    @Client() scrollPrev() { if (this.requestedValue !== undefined || !this.atStart) this.move(this.index(this.requestedValue) - 1); }
    private move(index: number, smooth = true) {
        const viewport = this.viewport;
        if (!this.cleanup || !viewport?.isConnected || index < 0 || index >= this.props.slides.length) return;
        this.requestedValue = this.props.slides[index].value;
        this.align(index, smooth); this.settle();
    }
    private connect(viewport: HTMLDivElement) {
        this.viewport = viewport;
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || this.viewport !== viewport || !viewport.isConnected) return;
            if (!this.cleanup) this.attach(viewport);
            const elements = new Set(this.elements());
            for (const element of this.observedSlides) if (!elements.has(element as HTMLDivElement)) { this.resizeObserver?.unobserve(element); this.observedSlides.delete(element); }
            for (const element of elements) if (!this.observedSlides.has(element)) { this.resizeObserver?.observe(element); this.observedSlides.add(element); }
            const direction = viewport.ownerDocument.defaultView!.getComputedStyle(viewport).direction;
            const signature = JSON.stringify([this.props.id, direction, this.props.slides.map(slide => [slide.value, slide.size, slide.label]), this.props.slideSize, this.props.emptyLabel]);
            if (signature !== this.signature) {
                this.signature = signature; this.direction = direction;
                const index = this.index(this.requestedValue); this.requestedValue = undefined; this.record(index); this.align(index, false);
                if (!this.initialized) { this.initialized = true; this.notifiedValue = this.activeValue; }
                else this.settle();
            }
            const old = this.focusedBeforeRender; this.focusedBeforeRender = undefined;
            if (old && (viewport.ownerDocument.activeElement === old || viewport.ownerDocument.activeElement === viewport.ownerDocument.body)) {
                const target = old.isConnected && old.getClientRects().length && !old.matches(':disabled') && !old.closest('[hidden],[inert]') ? old : viewport;
                target.focus({ preventScroll: true });
                if (viewport.ownerDocument.activeElement === viewport.ownerDocument.body) viewport.focus({ preventScroll: true });
            }
        });
    }
    @Client()
    private viewportKeydown(event: KeyboardEvent) {
        const viewport = this.viewport;
        if (!viewport || event.target !== viewport || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const rtl = viewport.ownerDocument.defaultView!.getComputedStyle(viewport).direction === 'rtl';
        if (event.key === 'Home') { event.preventDefault(); this.move(0); }
        else if (event.key === 'End') { event.preventDefault(); this.move(this.props.slides.length - 1); }
        else if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { event.preventDefault(); this.scrollNext(); }
        else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { event.preventDefault(); this.scrollPrev(); }
    }
    @Client()
    private viewportFocus(event: FocusEvent) {
        const index = this.elements().findIndex(element => element.contains(event.target as Node));
        if (index >= 0 && this.cleanup) {
            this.requestedValue = undefined; this.record(index);
            if (!this.fullyVisible(this.elements()[index])) this.move(index, false);
            else { this.viewport!.scrollTo({ left: this.viewport!.scrollLeft, behavior: 'instant' }); this.settle(); }
        }
    }
    @Client()
    private interrupt() {
        if (this.viewport && this.requestedValue !== undefined) { this.requestedValue = undefined; this.viewport.scrollTo({ left: this.viewport.scrollLeft, behavior: 'instant' }); }
    }
    private attach(viewport: HTMLDivElement) {
        const window = viewport.ownerDocument.defaultView!;
        const resize = () => {
            if (!this.cleanup) return;
            if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
            this.frame = window.requestAnimationFrame(() => { this.frame = undefined; if (this.cleanup && viewport.isConnected) { this.align(this.index(this.requestedValue), false); this.settle(); } });
        };
        const observer = new ResizeObserver(resize); this.resizeObserver = observer; observer.observe(viewport);
        const direction = new MutationObserver(() => {
            const value = window.getComputedStyle(viewport).direction;
            if (value !== this.direction) { this.direction = value; resize(); }
        });
        for (let element: HTMLElement | null = viewport; element; element = element.parentElement) direction.observe(element, { attributes: true, attributeFilter: ['dir', 'class', 'style'] });
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const motionChange = () => { if (motion.matches && this.requestedValue !== undefined) { this.align(this.index(this.requestedValue), false); this.settle(); } };
        window.addEventListener('resize', resize); motion.addEventListener('change', motionChange);
        this.cleanup = () => {
            observer.disconnect(); this.resizeObserver = undefined; this.observedSlides.clear(); direction.disconnect(); motion.removeEventListener('change', motionChange); window.removeEventListener('resize', resize);
            if (this.frame !== undefined) window.cancelAnimationFrame(this.frame); this.frame = undefined;
            if (this.settleTimer !== undefined) clearTimeout(this.settleTimer); this.settleTimer = undefined;
        };
    }
    onCleanup() { this.generation++; this.cleanup?.(); this.cleanup = undefined; this.viewport = undefined; this.focusedBeforeRender = undefined; }
}
