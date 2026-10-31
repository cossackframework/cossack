/**
 * Responsive images: the widths the media route serves, crop and focal point edits, and the
 * URLs and `srcset` of an image. Client-safe; the host's image transformer makes the variants.
 */

/** Widths variants are made in. Requests for other widths use the next larger one. */
export const IMAGE_WIDTHS = Object.freeze([320, 640, 960, 1280, 1920, 2560] as const);

/** Types the transformer resizes. GIF keeps its animation and SVG scales by itself, so both are served as uploaded. */
export const TRANSFORMABLE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export interface ImageRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Edits of an image: a crop in source pixels, and the point to keep in view when filling a shape (0-1 each way). */
export interface ImageEdits {
    readonly crop?: ImageRect;
    readonly focus?: { readonly x: number; readonly y: number };
}

/** What an image needs to describe its variants. */
export interface ImageSource {
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly edits?: ImageEdits | null;
    /** Changes when the image's edits change, so cached variants are not reused. */
    readonly version: number;
}

/** Problems with edits for an image of this size; empty when valid. */
export function imageEditsProblems(edits: ImageEdits, width: number, height: number): string[] {
    const problems: string[] = [];
    if (edits.crop !== undefined) {
        const { x, y, width: w, height: h } = edits.crop;
        if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 16 || h < 16 || x + w > width || y + h > height) problems.push('The crop must lie inside the image and be at least 16 pixels each way.');
    }
    if (edits.focus !== undefined) {
        const { x, y } = edits.focus;
        if (![x, y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) problems.push('The focal point is two numbers from 0 to 1.');
    }
    return problems;
}

/** The image's size after its crop. */
export function editedSize(image: Pick<ImageSource, 'width' | 'height' | 'edits'>): { width: number; height: number } | null {
    if (!image.width || !image.height) return null;
    const crop = image.edits?.crop;
    return crop ? { width: crop.width, height: crop.height } : { width: image.width, height: image.height };
}

/** The variant width serving `width`: the smallest listed width at least as large, or the largest. */
export function variantWidth(width: number): number {
    return IMAGE_WIDTHS.find(entry => entry >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

/**
 * The part of the (cropped) image a variant shows: all of it, or for a target shape the
 * largest rectangle of that shape around the focal point.
 */
export function variantRect(image: Pick<ImageSource, 'width' | 'height' | 'edits'>, aspect?: number): ImageRect | null {
    if (!image.width || !image.height) return null;
    const base = image.edits?.crop ?? { x: 0, y: 0, width: image.width, height: image.height };
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return base;
    const focus = image.edits?.focus ?? { x: 0.5, y: 0.5 };
    let width = base.width;
    let height = Math.round(width / aspect);
    if (height > base.height) { height = base.height; width = Math.round(height * aspect); }
    const centre = (start: number, size: number, part: number, at: number) => Math.min(Math.max(Math.round(start + size * at - part / 2), start), start + size - part);
    return { x: centre(base.x, base.width, width, focus.x), y: centre(base.y, base.height, height, focus.y), width, height };
}

/** Whether variants can be made of this file. */
export function transformable(contentType: string): boolean {
    return TRANSFORMABLE_TYPES.includes(contentType);
}

/** The URL of a variant: `/media/<id>/<name>?w=640&v=<version>`, with `h` for a fixed shape. */
export function imageUrl(image: ImageSource, options: { width: number; height?: number }): string {
    const params = new URLSearchParams({ w: String(variantWidth(options.width)) });
    if (options.height) params.set('h', String(Math.max(1, Math.round(options.height * variantWidth(options.width) / options.width))));
    params.set('v', String(image.version));
    return `/media/${image.id}/${encodeURIComponent(image.name)}?${params}`;
}

/**
 * A `srcset` of the image's variants up to its own width, or empty when it cannot be resized.
 * With `aspect`, every variant has that shape around the focal point.
 */
export function imageSrcset(image: ImageSource, options: { aspect?: number } = {}): string {
    const size = editedSize(image);
    if (!size || !transformable(image.contentType)) return '';
    // Each listed width below the image's own, then the image at full size.
    const widths: number[] = IMAGE_WIDTHS.filter(width => width < size.width);
    widths.push(Math.min(size.width, IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!));
    return [...new Set(widths.map(variantWidth))].map(width => `${imageUrl(image, { width, ...(options.aspect ? { height: Math.round(width / options.aspect) } : {}) })} ${Math.min(width, size.width)}w`).join(', ');
}
