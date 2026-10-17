/**
 * Media helpers shared by the dashboard and the server: accepted types, file signatures,
 * image dimensions and public URLs. Pure functions over bytes; no I/O.
 */

/** Content types accepted by default. SVG and HTML are excluded: they can run script. */
export const MEDIA_TYPES = Object.freeze([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
    'application/pdf', 'text/plain', 'video/mp4', 'video/webm', 'audio/mpeg',
]);

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** Profile pictures: still and animated images (GIF, APNG, animated WebP and AVIF). */
export const AVATAR_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export function mediaKind(contentType: string): MediaKind {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    return 'document';
}

/** Content type prefixes for each library filter. */
export const MEDIA_FILTERS: { readonly [K in MediaKind]: readonly string[] } = Object.freeze({
    image: ['image/'], video: ['video/'], audio: ['audio/'], document: ['application/', 'text/'],
});

/** The public URL of a stored file. The name is decorative; the ID selects the file. */
export function mediaUrl(file: { readonly id: string; readonly name: string }): string {
    return `/media/${file.id}/${encodeURIComponent(file.name)}`;
}

export function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = size / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));

/**
 * True when the first bytes fit the declared type. Images, PDF, video and audio have
 * signatures; plain text must not contain NUL bytes.
 */
export function matchesSignature(contentType: string, head: Uint8Array): boolean {
    switch (contentType) {
        case 'image/png': return head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a;
        case 'image/jpeg': return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
        case 'image/gif': return ['GIF87a', 'GIF89a'].includes(ascii(head, 0, 6));
        case 'image/webp': return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP';
        case 'image/avif': return ascii(head, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(head, 8, 4));
        case 'application/pdf': return ascii(head, 0, 5) === '%PDF-';
        case 'video/mp4': return ascii(head, 4, 4) === 'ftyp';
        case 'video/webm': return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
        case 'audio/mpeg': return ascii(head, 0, 3) === 'ID3' || (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
        case 'text/plain': return !head.includes(0);
        default: return false;
    }
}

/** Width and height of a PNG, GIF, JPEG or WebP image from its first bytes, or null. */
export function imageSize(contentType: string, bytes: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const valid = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : null;
    try {
        if (contentType === 'image/png' && bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') return valid(view.getUint32(16), view.getUint32(20));
        if (contentType === 'image/gif' && bytes.length >= 10) return valid(view.getUint16(6, true), view.getUint16(8, true));
        if (contentType === 'image/webp' && bytes.length >= 30) {
            const chunk = ascii(bytes, 12, 4);
            if (chunk === 'VP8 ') return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
            if (chunk === 'VP8L') {
                const bits = view.getUint32(21, true);
                return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
            }
            if (chunk === 'VP8X') return valid(1 + (bytes[24]! | bytes[25]! << 8 | bytes[26]! << 16), 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16));
            return null;
        }
        if (contentType === 'image/jpeg') {
            // Walk the segments to the first start-of-frame marker.
            let offset = 2;
            while (offset + 9 < bytes.length) {
                if (bytes[offset] !== 0xff) return null;
                const marker = bytes[offset + 1]!;
                if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { offset += marker === 0xff ? 1 : 2; continue; }
                const length = view.getUint16(offset + 2);
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return valid(view.getUint16(offset + 7), view.getUint16(offset + 5));
                offset += 2 + length;
            }
        }
    } catch { /* truncated header */ }
    return null;
}
