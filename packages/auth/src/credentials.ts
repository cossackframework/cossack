import { AuthError, authOperation } from './errors';
import { createPasswordHasher, type PasswordHasher } from './password';

export interface CredentialVerifierOptions<Record, User> {
    /** Identifier normalization, account storage and uniqueness belong to the application. */
    find(identifier: string): Promise<Record | null>;
    passwordHash(record: Record): string | null;
    user(record: Record): User | Promise<User>;
    hasher?: PasswordHasher;
    /** Atomically replace only expectedHash. False rejects a stale login; errors never expose account data. */
    replacePasswordHash?(record: Record, expectedHash: string, replacement: string): Promise<boolean>;
}

export interface CredentialVerifier<User> {
    verify(identifier: string, password: string): Promise<User | null>;
}

/** Shared credential verification with application-owned lookup, mapping and conditional writes. */
export function createCredentialVerifier<Record, User>(options: CredentialVerifierOptions<Record, User>): CredentialVerifier<User> {
    const hasher = options.hasher ?? createPasswordHasher();
    if (![options.find, options.passwordHash, options.user, hasher.hash, hasher.verify].every(value => typeof value === 'function') ||
        (options.replacePasswordHash !== undefined && typeof options.replacePasswordHash !== 'function') ||
        (hasher.needsRehash !== undefined && typeof hasher.needsRehash !== 'function')) throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID');
    return Object.freeze({
        async verify(identifier: string, password: string) {
            if (typeof identifier !== 'string' || !identifier || typeof password !== 'string' || !password) return null;
            const record = await authOperation('COSSACK_AUTH_CREDENTIAL_LOOKUP_FAILED', () => options.find(identifier));
            if (!record) return null;
            const stored = await authOperation('COSSACK_AUTH_CREDENTIAL_LOOKUP_FAILED', () => options.passwordHash(record));
            if (!stored) return null;
            const accepted = await authOperation('COSSACK_AUTH_PASSWORD_VERIFY_FAILED', () => hasher.verify(password, stored));
            if (accepted !== true) return null;
            const upgrade = options.replacePasswordHash && await authOperation('COSSACK_AUTH_CREDENTIAL_UPDATE_FAILED', () => hasher.needsRehash?.(stored));
            if (upgrade === true) {
                const replacement = await authOperation('COSSACK_AUTH_PASSWORD_HASH_FAILED', () => hasher.hash(password));
                const replaced = await authOperation('COSSACK_AUTH_CREDENTIAL_UPDATE_FAILED', () => options.replacePasswordHash!(record, stored, replacement));
                if (replaced !== true) return null;
            }
            return authOperation('COSSACK_AUTH_CREDENTIAL_MAPPING_FAILED', () => options.user(record));
        },
    });
}
