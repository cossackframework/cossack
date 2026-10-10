import { AuthError, authOperation } from './errors';

/** Applications can supply another server-side hashing implementation. */
export interface PasswordHasher {
    hash(password: string): Promise<string>;
    verify(password: string, stored: string): Promise<boolean>;
    /** This must inspect the stored format without deriving a key. */
    needsRehash?(stored: string): boolean;
}

export interface PasswordHasherOptions {
    /** PBKDF2-HMAC-SHA256 work factor. Default: 100,000. Verify runtime limits before raising it. */
    iterations?: number;
    /** Maximum stored work factor accepted for verification. Default: iterations. */
    maxIterations?: number;
    /** Maximum UTF-8 password bytes. Default: 1,024. Inputs are never truncated or normalized. */
    maxPasswordBytes?: number;
}

const format = /^pbkdf2-sha256\$([1-9]\d{0,7})\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value.match(/../g)!, part => Number.parseInt(part, 16));
}

/** Web Crypto only. The stored format includes its algorithm and work factor. */
export function createPasswordHasher(options: PasswordHasherOptions = {}): PasswordHasher {
    const iterations = options.iterations ?? 100_000;
    const maxIterations = options.maxIterations ?? iterations;
    const maxPasswordBytes = options.maxPasswordBytes ?? 1024;
    if (![iterations, maxIterations, maxPasswordBytes].every(Number.isSafeInteger) ||
        iterations < 1 || maxIterations < iterations || maxIterations > 10_000_000 ||
        maxPasswordBytes < 1 || maxPasswordBytes > 65_536) throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID');

    const input = (password: string): Uint8Array<ArrayBuffer> | null => {
        if (typeof password !== 'string' || !password || password.length > maxPasswordBytes) return null;
        const value = new TextEncoder().encode(password);
        return value.length <= maxPasswordBytes ? value : null;
    };
    const parse = (stored: string) => {
        if (typeof stored !== 'string' || stored.length > 128) return null;
        const match = format.exec(stored);
        if (!match || Number(match[1]) > maxIterations) return null;
        return { iterations: Number(match[1]), salt: bytes(match[2]!), digest: bytes(match[3]!) };
    };
    const derive = async (password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, count: number) => {
        const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: count }, key, 256));
    };

    return Object.freeze({
        async hash(password: string) {
            const value = input(password);
            if (!value) throw new AuthError('COSSACK_AUTH_PASSWORD_INVALID');
            return authOperation('COSSACK_AUTH_PASSWORD_HASH_FAILED', async () => {
                const salt = crypto.getRandomValues(new Uint8Array(16));
                return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(await derive(value, salt, iterations))}`;
            });
        },
        async verify(password: string, stored: string) {
            const value = input(password);
            const parsed = parse(stored);
            if (!value || !parsed) return false;
            return authOperation('COSSACK_AUTH_PASSWORD_VERIFY_FAILED', async () => {
                const actual = await derive(value, parsed.salt, parsed.iterations);
                let difference = 0;
                for (let index = 0; index < actual.length; index++) difference |= actual[index]! ^ parsed.digest[index]!;
                return difference === 0;
            });
        },
        needsRehash(stored: string) {
            const parsed = parse(stored);
            // Never replace a valid stronger work factor with a weaker one.
            return !parsed || parsed.iterations < iterations;
        },
    });
}

export function hashPassword(password: string): Promise<string> { return createPasswordHasher().hash(password); }
export function verifyPassword(password: string, stored: string): Promise<boolean> { return createPasswordHasher().verify(password, stored); }
