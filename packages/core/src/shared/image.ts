import { html, ifDefined } from '@cossackframework/renderer';

export interface ImageProps {
    src: string;
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'scale-down' | 'crop' | 'pad';
    quality?: number;
    format?: 'webp' | 'avif';
    alt?: string;
    class?: string;
    loading?: 'lazy' | 'eager';
}

export interface ImageDiagnostic { code: string; severity: 'error' | 'warning'; message: string; action: string; }
/** Static rendering diagnostics do not verify Cloudflare account/zone setup. */
export function imageDiagnostics(props: ImageProps, options: { provider?: string; development?: boolean } = {}): ImageDiagnostic[] {
    const diagnostics: ImageDiagnostic[] = [];
    const add = (code: string, severity: ImageDiagnostic['severity'], message: string, action: string) => diagnostics.push({ code, severity, message, action });
    const provider = options.provider ?? 'none';
    if (!['none', 'cloudflare'].includes(provider)) add('COSSACK_IMAGE_PROVIDER_INVALID', 'error', 'The image provider is unsupported.', 'Set VITE_COSSACK_IMAGE_PROVIDER to none or cloudflare.');
    if (typeof props.src !== 'string' || !props.src || /[\x00-\x1f\x7f]/.test(props.src) || (/^[a-z][a-z0-9+.-]*:/i.test(props.src) && !/^(https?:|data:image\/)/i.test(props.src))) add('COSSACK_IMAGE_SOURCE_INVALID', 'error', 'The image source is unsupported.', 'Use a relative asset, HTTP image URL or image data URI.');
    for (const dimension of ['width', 'height'] as const) if (props[dimension] !== undefined && (!Number.isInteger(props[dimension]) || props[dimension]! < 1)) add('COSSACK_IMAGE_DIMENSION_INVALID', 'error', 'Image dimensions must be positive integer pixels.', 'Supply a positive width and height, or omit them.');
    if (props.quality !== undefined && (!Number.isInteger(props.quality) || props.quality < 1 || props.quality > 100)) add('COSSACK_IMAGE_QUALITY_INVALID', 'error', 'Image quality must be an integer from 1 to 100.', 'Correct the quality value.');
    if (props.fit !== undefined && !['cover', 'contain', 'scale-down', 'crop', 'pad'].includes(props.fit)) add('COSSACK_IMAGE_FIT_INVALID', 'error', 'The image fit is unsupported.', 'Use cover, contain, scale-down, crop or pad.');
    if (props.format !== undefined && !['webp', 'avif'].includes(props.format)) add('COSSACK_IMAGE_FORMAT_INVALID', 'error', 'The requested format cannot be rendered as an image.', 'Use webp or avif; JSON metadata is not an img source.');
    if (props.fit !== undefined || props.quality !== undefined || props.format !== undefined) {
        if (provider === 'none') add('COSSACK_IMAGE_TRANSFORM_UNAVAILABLE', 'warning', 'The original image is rendered; transform options are not applied.', 'Configure Cloudflare Image Resizing or generate local variants with cossack image optimize.');
        else if (options.development) add('COSSACK_IMAGE_TRANSFORM_LOCAL', 'warning', 'Local development renders the original image.', 'Verify transforms on a Cloudflare zone with Image Resizing enabled.');
    }
    return diagnostics;
}

export function Image(props: ImageProps) {
    let finalSrc = props.src;
    
    // @ts-ignore - handled by Vite in the consuming application
    const provider = import.meta.env?.VITE_COSSACK_IMAGE_PROVIDER || 'none';
    // @ts-ignore
    const isDev = import.meta.env?.DEV;
    const diagnostics = imageDiagnostics(props, { provider, development: isDev });
    const failure = diagnostics.find(item => item.severity === 'error');
    if (failure) throw Object.assign(new Error(failure.message + ' ' + failure.action), { code: failure.code });
    if (isDev) for (const item of diagnostics) console.warn(`[${item.code}] ${item.message} ${item.action}`);

    // Only apply optimization if provider is cloudflare and NOT in dev mode (unless we want to test it)
    // Usually local dev cannot handle /cdn-cgi/image paths unless proxied.
    if (provider === 'cloudflare' && !isDev) {
        // Construct Cloudflare Image Resizing URL
        // https://developers.cloudflare.com/images/image-resizing/url-format/
        
        const optionsParts: string[] = [];
        
        if (props.width) optionsParts.push(`width=${props.width}`);
        if (props.height) optionsParts.push(`height=${props.height}`);
        if (props.fit) optionsParts.push(`fit=${props.fit}`);
        if (props.quality) optionsParts.push(`quality=${props.quality}`);
        if (props.format) optionsParts.push(`format=${props.format}`);
        
        if (optionsParts.length > 0) {
            const optionsString = optionsParts.join(',');
            // If src is absolute (http...), we might need to be careful.
            // Cloudflare supports resizing remote images if configured.
            // For relative images (assets), it works relative to the zone.
            
            finalSrc = `/cdn-cgi/image/${optionsString}/${props.src.startsWith('/') ? props.src.slice(1) : props.src}`;
        }
    }

    return html`<img 
        src="${finalSrc}" 
        alt="${props.alt || ''}" 
        width=${ifDefined(props.width)}
        height=${ifDefined(props.height)}
        class="${props.class || ''}" 
        loading="${props.loading || 'lazy'}" 
    />`;
}
