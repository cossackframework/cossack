/**
 * Second factors without a server dependency: time-based one-time passwords (RFC 6238, the
 * codes authenticator apps show) and single-use recovery codes. Web Crypto only, so this runs
 * on Workers and Node alike. Storage belongs to the application.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpOptions {
    /** Seconds per code. Default 30. */
    readonly period?: number;
    /** Digits per code. Default 6. */
    readonly digits?: number;
}

/** RFC 4648 base32 without padding, as authenticator apps expect secrets. */
export function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
    const clean = text.toUpperCase().replace(/[\s=-]/g, '');
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;
    for (const character of clean) {
        const index = ALPHABET.indexOf(character);
        if (index < 0) throw new TypeError('Invalid base32 text.');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return new Uint8Array(bytes);
}

/** A new random TOTP secret: 20 bytes (160 bits, as RFC 4226 recommends) in base32. */
export function generateTotpSecret(bytes = 20): string {
    return base32Encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The `otpauth://` URI authenticator apps read from a QR code. */
export function totpUri(input: { secret: string; issuer: string; account: string } & TotpOptions): string {
    const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
    const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(input.digits ?? 6), period: String(input.period ?? 30) });
    return `otpauth://totp/${label}?${params}`;
}

/** The time step of a moment, in periods since the Unix epoch. */
export function totpStep(now: number, period = 30): number {
    return Math.floor(now / 1000 / period);
}

/** The code for a time step (HOTP over the step counter, RFC 4226). */
export async function totpCode(secret: string, step: number, digits = 6): Promise<string> {
    const counter = new Uint8Array(8);
    let remaining = step;
    for (let index = 7; index >= 0; index--) {
        counter[index] = remaining & 255;
        remaining = Math.floor(remaining / 256);
    }
    const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
    const offset = mac[mac.length - 1]! & 15;
    const binary = ((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
    return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Check a code against the steps around `now` (one step each way by default, for clock
 * drift). Returns the matching step, which callers store so the same code cannot be used
 * twice, or null. Steps at or before `afterStep` never match.
 */
export async function verifyTotp(secret: string, code: string, options: TotpOptions & { now?: number; window?: number; afterStep?: number | null } = {}): Promise<number | null> {
    const digits = options.digits ?? 6;
    const clean = String(code ?? '').replace(/\s/g, '');
    if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return null;
    const current = totpStep(options.now ?? Date.now(), options.period ?? 30);
    const window = options.window ?? 1;
    let found: number | null = null;
    // Check every step, so timing does not reveal which one matched.
    for (let step = current - window; step <= current + window; step++) {
        const expected = await totpCode(secret, step, digits);
        if (equal(expected, clean) && (options.afterStep === undefined || options.afterStep === null || step > options.afterStep) && found === null) found = step;
    }
    return found;
}

/** Ten single-use recovery codes such as `k7f2m-q9x4p`. Store only their hashes. */
export function generateRecoveryCodes(count = 10): string[] {
    const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: count }, () => {
        const bytes = crypto.getRandomValues(new Uint8Array(10));
        const text = [...bytes].map(byte => letters[byte % letters.length]).join('');
        return `${text.slice(0, 5)}-${text.slice(5)}`;
    });
}

/** A recovery code as typed: lowercase, without spaces or dashes. */
export function normalizeRecoveryCode(code: string): string {
    return String(code ?? '').toLowerCase().replace(/[\s-]/g, '');
}

/** SHA-256 of the normalized code, for storage and comparison. */
export async function hashRecoveryCode(code: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`recovery:${normalizeRecoveryCode(code)}`));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function equal(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    return difference === 0;
}
