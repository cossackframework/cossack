import { html, ifDefined } from '@cossackframework/renderer';

export interface ImageProps {
    src: string;
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'scale-down' | 'none' | 'contain-fit' | 'cover-fit';
    quality?: number;
    format?: 'webp' | 'avif' | 'json';
    alt?: string;
    class?: string;
    loading?: 'lazy' | 'eager';
}

export function Image(props: ImageProps) {
    let finalSrc = props.src;
    
    // @ts-ignore - handled by Vite in the consuming application
    const provider = import.meta.env?.VITE_COSSACK_IMAGE_PROVIDER || 'none';
    // @ts-ignore
    const isDev = import.meta.env?.DEV;

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
