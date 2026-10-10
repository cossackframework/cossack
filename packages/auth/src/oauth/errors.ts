const failures = {
    COSSACK_OAUTH_CONFIGURATION_INVALID: ['configuration', 500, 'OAuth configuration is invalid. Check provider definitions and callback URLs.'],
    COSSACK_OAUTH_SECRET_INVALID: ['configuration', 500, 'OAuth state secret must contain at least 16 characters. Configure a random secret through server bindings.'],
    COSSACK_OAUTH_PROVIDER_UNKNOWN: ['configuration', 500, 'Unknown OAuth provider. Register the provider before mounting its routes.'],
    COSSACK_OAUTH_CREDENTIALS_MISSING: ['configuration', 500, 'OAuth credentials are missing. Configure clientId, clientSecret and redirectUrl for the provider.'],
    COSSACK_OAUTH_STATE_STORE_INVALID: ['configuration', 500, 'Cookie-based OAuth requires a stateStore with create and atomic consume callbacks.'],
    COSSACK_OAUTH_REDIRECT_FAILED: ['redirect', 500, 'OAuth redirect preparation failed. Check provider configuration and cookie settings.'],
    COSSACK_OAUTH_CALLBACK_INVALID: ['callback', 400, 'OAuth callback is missing required code or state parameters. Start a new authorization flow.'],
    COSSACK_OAUTH_CONSENT_DENIED: ['callback', 403, 'OAuth consent was denied. Start a new authorization flow to try again.'],
    COSSACK_OAUTH_PROVIDER_DENIED: ['callback', 502, 'OAuth provider rejected the authorization request. Check provider configuration.'],
    COSSACK_OAUTH_STATE_INVALID: ['state', 400, 'OAuth state cookie is missing, expired or invalid. Start a new authorization flow.'],
    COSSACK_OAUTH_STATE_MISMATCH: ['state', 400, 'OAuth state mismatch. Start a new authorization flow.'],
    COSSACK_OAUTH_STATE_UNAVAILABLE: ['state', 400, 'OAuth state was already used, expired or unavailable. Start a new authorization flow.'],
    COSSACK_OAUTH_STATE_CREATE_FAILED: ['state-create', 500, 'OAuth state storage failed. Check application state storage.'],
    COSSACK_OAUTH_STATE_CONSUME_FAILED: ['state-consume', 500, 'OAuth state consumption failed. Check application atomic state storage.'],
    COSSACK_OAUTH_TOKEN_EXCHANGE_FAILED: ['token-exchange', 502, 'OAuth token exchange failed. Check provider credentials and callback configuration.'],
    COSSACK_OAUTH_USER_INFO_FAILED: ['user-info', 502, 'OAuth user-info processing failed. Check provider scopes and profile normalization.'],
    COSSACK_OAUTH_ACCOUNT_MAPPING_FAILED: ['account-mapping', 500, 'OAuth account mapping failed. Check application account lookup and session creation.'],
    COSSACK_OAUTH_ERROR_HANDLER_FAILED: ['error-handler', 500, 'OAuth error handler failed. Check the application onError callback.'],
} as const;

export type OAuthErrorCode = keyof typeof failures;
export type OAuthErrorStage = typeof failures[OAuthErrorCode][0];

/** Safe OAuth diagnostics. Raw exceptions, response bodies and credentials are never retained. */
export class OAuthError extends Error {
    readonly code: OAuthErrorCode;
    readonly stage: OAuthErrorStage;
    readonly status: 400 | 403 | 500 | 502;
    readonly providerStatus?: number;

    constructor(code: OAuthErrorCode, providerStatus?: number) {
        if (!Object.hasOwn(failures, code)) throw new TypeError('Invalid OAuth diagnostic code.');
        const [stage, status, message] = failures[code];
        super(message);
        this.name = 'OAuthError';
        this.code = code;
        this.stage = stage;
        this.status = status;
        if (typeof providerStatus === 'number' && Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599) {
            this.providerStatus = providerStatus;
        }
        Object.freeze(this);
    }

    toJSON() {
        return { code: this.code, stage: this.stage, status: this.status, message: this.message,
            ...(this.providerStatus === undefined ? {} : { providerStatus: this.providerStatus }) };
    }
}

/** Preserve only a matching stage's validated HTTP status, never the thrown value. */
export async function runOAuthStage<T>(code: OAuthErrorCode, operation: () => T | Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
        throw new OAuthError(code, error instanceof OAuthError && error.code === code ? error.providerStatus : undefined);
    }
}

export function safeOAuthError(error: unknown, fallback: OAuthErrorCode): OAuthError {
    return error instanceof OAuthError && Object.hasOwn(failures, error.code)
        ? new OAuthError(error.code, error.providerStatus) : new OAuthError(fallback);
}
