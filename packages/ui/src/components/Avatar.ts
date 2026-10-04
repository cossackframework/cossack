import { html, ifDefined, IfDefinedResult, repeat } from '@cossackframework/renderer';
import { Cossack, Component, ClientState } from '@cossackframework/core';
import type { GlobalAttributes, ControlEvent } from '../native-attributes';

export type AvatarProps = Omit<GlobalAttributes<HTMLSpanElement>,
    'role' | 'aria-label' | 'aria-labelledby' | 'aria-hidden' | 'tabindex' | 'autofocus' | '?autofocus' | 'contenteditable'> & {
    src?: string;
    /** Meaningful name; use an explicit empty string for decorative avatars. */
    alt: string;
    size?: number;
    shape?: 'circle' | 'square';
    loading?: 'eager' | 'lazy';
    decoding?: 'sync' | 'async' | 'auto';
    referrerpolicy?: ReferrerPolicy;
    onImageLoad?: (event: ControlEvent<HTMLImageElement>) => unknown;
    onImageError?: (event: ControlEvent<HTMLImageElement>) => unknown;
};

/** Stable image semantics with source-owned failure recovery and noninteractive fallback content. */
@Component()
export class Avatar extends Cossack {
    declare props: AvatarProps;
    @ClientState() private failedRequest = -1;
    private requestVersion = 0;
    private renderedSource?: string;
    private currentImage?: HTMLImageElement;

    private ownsImage(image: HTMLImageElement, version: number) {
        return this.currentImage === image && this.requestVersion === version && image.isConnected;
    }
    private attachImage(element: Element, version: number) {
        const image = element as HTMLImageElement;
        this.currentImage = image;
        // A cached image may finish before hydration attaches load/error listeners.
        queueMicrotask(() => {
            if (this.ownsImage(image, version) && image.complete && image.naturalWidth === 0) this.failedRequest = version;
        });
    }
    render() {
        const { src, alt, size = 40, shape = 'circle', style, loading, decoding, referrerpolicy,
            onImageLoad, onImageError, ...rest } = this.props;
        if (typeof alt !== 'string') throw new Error('Avatar requires alt text; use an empty string for decorative images.');
        if (src !== undefined && typeof src !== 'string') throw new Error('Avatar src must be a string.');
        if (!Number.isFinite(size) || size <= 0) throw new Error('Avatar size must be positive and finite.');
        if (shape !== 'circle' && shape !== 'square') throw new Error('Avatar shape must be circle or square.');
        const source = src?.trim() || undefined;
        if (source !== this.renderedSource) {
            this.renderedSource = source;
            this.requestVersion++;
            this.currentImage = undefined;
        }
        const version = this.requestVersion;
        const showImage = source !== undefined && this.failedRequest !== version;
        if (!showImage) this.currentImage = undefined;
        const name = alt.trim();
        const initials = name.split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0] ?? '').join('').toUpperCase();
        const suppliedStyle = style instanceof IfDefinedResult ? style.value : style;
        const dimensions = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;${typeof suppliedStyle === 'string' ? suppliedStyle : ''}`;
        return html`<span class=${`cs-avatar cs-avatar--${shape} inline-flex items-center justify-center overflow-hidden bg-muted text-muted-foreground font-medium select-none ${shape === 'circle' ? 'rounded-full' : 'rounded-md'}`}
            style=${dimensions} role=${ifDefined(name ? 'img' : undefined)} aria-label=${ifDefined(name || undefined)} aria-hidden=${ifDefined(name ? undefined : 'true')} ...=${rest}>
            ${repeat(showImage ? [version] : [], key => key, () => html`<img
                ref=${(element: Element) => this.attachImage(element, version)} src=${source} alt="" aria-hidden="true"
                loading=${ifDefined(loading)} decoding=${ifDefined(decoding)} referrerpolicy=${ifDefined(referrerpolicy)}
                class="cs-avatar__img w-full h-full object-cover"
                @load=${(event: ControlEvent<HTMLImageElement>) => { if (this.ownsImage(event.currentTarget, version)) onImageLoad?.(event); }}
                @error=${(event: ControlEvent<HTMLImageElement>) => { if (this.ownsImage(event.currentTarget, version)) { this.failedRequest = version; onImageError?.(event); } }} />`)}
            ${showImage ? null : html`<span aria-hidden="true" class="cs-avatar__fallback">${this.children ?? initials}</span>`}
        </span>`;
    }
    onCleanup() { this.currentImage = undefined; this.requestVersion++; }
}
