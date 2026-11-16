import { ClientVisibleError } from '@cossackframework/core';

export type CmsErrorCode =
    | 'CMS_UNAUTHENTICATED'
    | 'CMS_FORBIDDEN'
    | 'CMS_NOT_FOUND'
    | 'CMS_CONFLICT'
    | 'CMS_VALIDATION'
    | 'CMS_UNAVAILABLE'
    | 'CMS_UNCERTAIN'
    | 'CMS_LIMIT'
    /** The database was made by another build of the CMS: a setup mistake to fix, never a page to wait for. */
    | 'CMS_SCHEMA_MISMATCH';

const STATUS: { [C in CmsErrorCode]: number } = {
    CMS_UNAUTHENTICATED: 401, CMS_FORBIDDEN: 403, CMS_NOT_FOUND: 404, CMS_CONFLICT: 409,
    CMS_VALIDATION: 422, CMS_UNAVAILABLE: 503, CMS_UNCERTAIN: 503, CMS_LIMIT: 413, CMS_SCHEMA_MISMATCH: 500,
};

/**
 * A CMS failure with a stable code, an HTTP status and safe, user-facing text. It is a
 * `ClientVisibleError`, so a page's server action reports the message to the browser.
 */
export class CmsError extends ClientVisibleError {
    readonly code: CmsErrorCode;
    readonly status: number;
    /** Field errors for `CMS_VALIDATION`. */
    readonly fields?: { readonly [field: string]: string };
    /** Request ID of a write saved for recovery (`CMS_UNCERTAIN`). */
    readonly requestId?: string;
    /**
     * A `CMS_UNAVAILABLE` that lasts until someone acts (an inactive plugin, a pending schema
     * migration), not a passing database error: callers keeping an earlier answer refuse instead.
     */
    readonly lasting?: boolean;
    constructor(code: CmsErrorCode, message: string, details: { fields?: { [field: string]: string }; requestId?: string; cause?: unknown; lasting?: boolean } = {}) {
        super(message);
        if (details.cause !== undefined) Object.defineProperty(this, 'cause', { value: details.cause, configurable: true, writable: true });
        this.name = 'CmsError';
        this.code = code;
        this.status = STATUS[code];
        if (details.fields) this.fields = Object.freeze({ ...details.fields });
        if (details.requestId) this.requestId = details.requestId;
        if (details.lasting) this.lasting = true;
    }
}

export function isCmsError(error: unknown, code?: CmsErrorCode): error is CmsError {
    return error instanceof CmsError && (code === undefined || error.code === code);
}
