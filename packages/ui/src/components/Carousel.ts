import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";

export interface CarouselProps {
    [key: string]: any;
}

/**
 * Cossack UI Carousel — scroll-snap carousel with prev/next buttons.
 *
 * Uses native CSS scroll-snap for smooth scrolling. Pass slides as children.
 *
 *   ${component(Carousel, {},
 *       html\`${slides.map(s => html\`<div class="cs-carousel__slide ...">${s}</div>\`)}\`)}
 */
@Component()
export class Carousel extends Cossack {
    declare props: CarouselProps;

    viewportRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    render() {
        return html`
            <div class="cs-carousel relative w-full">
                <div
                    ref=${this.viewportRef}
                    class="cs-carousel__viewport flex overflow-x-auto scroll-smooth snap-x snap-mandatory gap-4 pb-4"
                    style="scrollbar-width:none;-ms-overflow-style:none;"
                >
                    ${this.children}
                </div>
                <button
                    type="button"
                    class="cs-carousel__prev absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border flex items-center justify-center cursor-pointer hover:bg-background shadow-sm"
                    aria-label="Previous slide"
                    @click=${() => this.scrollPrev()}
                >‹</button>
                <button
                    type="button"
                    class="cs-carousel__next absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border flex items-center justify-center cursor-pointer hover:bg-background shadow-sm"
                    aria-label="Next slide"
                    @click=${() => this.scrollNext()}
                >›</button>
            </div>
        `;
    }

    @Client()
    scrollNext() {
        const vp = this.viewportRef.value;
        if (vp) vp.scrollBy({ left: vp.clientWidth * 0.8, behavior: "smooth" });
    }

    @Client()
    scrollPrev() {
        const vp = this.viewportRef.value;
        if (vp) vp.scrollBy({ left: -vp.clientWidth * 0.8, behavior: "smooth" });
    }
}
