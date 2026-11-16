/** Random tokens and their hashes, for links and credentials stored as hashes. */

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** `bytes` random bytes as base64url. */
export function randomToken(bytes = 32): string {
    return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Compare two strings in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    return difference === 0;
}
