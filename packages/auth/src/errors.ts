const diagnostics = {
    COSSACK_AUTH_CONFIGURATION_INVALID: ['configuration', 'Authentication configuration is invalid. Check password, cookie and storage options.'],
    COSSACK_AUTH_PASSWORD_INVALID: ['password-input', 'Password input is invalid or exceeds the configured byte limit.'],
    COSSACK_AUTH_PASSWORD_HASH_FAILED: ['password-hash', 'Password hashing failed. Check the runtime crypto support and configured work factor.'],
    COSSACK_AUTH_PASSWORD_VERIFY_FAILED: ['password-verify', 'Password verification failed. Check the runtime crypto support and stored hash parameters.'],
    COSSACK_AUTH_CREDENTIAL_LOOKUP_FAILED: ['credential-lookup', 'Credential lookup failed. Check application account storage.'],
    COSSACK_AUTH_CREDENTIAL_UPDATE_FAILED: ['credential-update', 'Credential hash update failed. Check the conditional account update.'],
    COSSACK_AUTH_CREDENTIAL_MAPPING_FAILED: ['credential-mapping', 'Credential user mapping failed. Check application user and role lookup.'],
    COSSACK_AUTH_SESSION_CREATE_FAILED: ['session-create', 'Session creation failed. Check application session storage.'],
    COSSACK_AUTH_SESSION_READ_FAILED: ['session-read', 'Session lookup failed. Check application session storage.'],
    COSSACK_AUTH_SESSION_ROTATE_FAILED: ['session-rotate', 'Session rotation failed. Check the atomic session replacement.'],
    COSSACK_AUTH_SESSION_REVOKE_FAILED: ['session-revoke', 'Session revocation failed. Check application session storage.'],
} as const;

export type AuthErrorCode = keyof typeof diagnostics;
export type AuthErrorStage = typeof diagnostics[AuthErrorCode][0];

/** Fixed diagnostics without credential values, storage errors or exception causes. */
export class AuthError extends Error {
    readonly code: AuthErrorCode;
    readonly stage: AuthErrorStage;

    constructor(code: AuthErrorCode) {
        if (!Object.hasOwn(diagnostics, code)) throw new TypeError('Invalid authentication diagnostic code.');
        const [stage, message] = diagnostics[code];
        super(message);
        this.name = 'AuthError';
        this.code = code;
        this.stage = stage;
        Object.freeze(this);
    }

    toJSON() { return { code: this.code, stage: this.stage, message: this.message }; }
}

/** Keep only the operation stage when application/runtime code throws. */
export async function authOperation<T>(code: AuthErrorCode, operation: () => T | Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new AuthError(code); }
}
