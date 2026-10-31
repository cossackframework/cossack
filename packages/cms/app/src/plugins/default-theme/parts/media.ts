/** Images with their resized variants. */
import { html, ifDefined, type TemplateResult } from '@cossackframework/renderer';
import type { MediaView } from '@cossackframework/cms';

/** An image with its resized variants; `sizes` says how wide it shows, so the browser picks one. */
export function image(media: MediaView | null, className: string, sizes = '(min-width: 1024px) 1024px, 100vw', wide = false): TemplateResult | null {
    if (!media) return null;
    const fill = wide && Boolean(media.wideSrcset);
    const srcset = fill ? media.wideSrcset : media.srcset;
    // A 16:9 frame: its size, so the page does not shift while the image loads.
    const height = fill && media.width ? Math.round(media.width * 9 / 16) : media.height;
    return html`<img src=${media.url} srcset=${ifDefined(srcset || undefined)} sizes=${ifDefined(srcset ? sizes : undefined)} alt=${media.alt} width=${media.width ?? ''} height=${height ?? ''} loading="lazy" decoding="async" class=${className}
        style=${ifDefined(media.placeholder ? `background-image:url(${media.placeholder});background-size:cover;background-repeat:no-repeat` : undefined)}>`;
}
