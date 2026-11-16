/**
 * Image transformers make the resized variants the media route serves: the Cloudflare Images
 * binding on Workers, sharp on Node. The host computes the region and size; a transformer only
 * cuts, scales and encodes.
 */
import type { ImageRect } from '../images';

export type ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png';

export interface ImageTransformRequest {
    /** The part of the source to keep, in source pixels. */
    readonly rect: ImageRect;
    /** The source's full size, for transformers that trim by edges. */
    readonly source: { readonly width: number; readonly height: number };
    /** The output size; the region already has its shape. */
    readonly width: number;
    readonly height: number;
    readonly format: ImageFormat;
    readonly quality: number;
}

export interface ImageTransformer {
    transform(input: ReadableStream<Uint8Array>, request: ImageTransformRequest): Promise<Uint8Array>;
}

export const FORMAT_TYPES: { readonly [F in ImageFormat]: string } = Object.freeze({ avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' });

/** The best format the browser accepts: AVIF, then WebP, else the original's. */
export function negotiateFormat(accept: string | undefined, contentType: string): ImageFormat {
    const header = (accept ?? '').toLowerCase();
    if (header.includes('image/avif')) return 'avif';
    if (header.includes('image/webp')) return 'webp';
    return contentType === 'image/png' ? 'png' : 'jpeg';
}
