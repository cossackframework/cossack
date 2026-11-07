// Session-based authentication
export { AuthError, type AuthErrorCode, type AuthErrorStage } from './errors';
export { createPasswordHasher, hashPassword, verifyPassword, type PasswordHasher, type PasswordHasherOptions } from './password';
export { createCredentialVerifier, type CredentialVerifier, type CredentialVerifierOptions } from './credentials';
export { createSessionManager, type AuthSessionRecord, type AuthSessionStore, type AuthSessionOptions,
    type AuthSessionManager, type IssuedAuthSession } from './sessions';
export {
    createAuth,
    type AuthKit,
    type AuthProvider,
    type LoginHandlerOptions,
    type SessionCreator,
    type AuthRealtimeIdentity,
    type AuthRealtimeProvider,
} from './session';

// OAuth 2.0 authentication
export {
    createOAuth,
    defineOAuthProvider,
    OAuthError,
    type OAuthErrorCode,
    type OAuthErrorStage,
    type CreateOAuthConfig,
    type OAuthCookieOptions,
    type OAuthErrorCallback,
    type OAuthKit,
    type OAuthProviderConfig,
    type OAuthProviderDefinition,
    type OAuthUser,
    type OAuthUserCallback,
    type OAuthStateRecord,
    type OAuthStateStore,
    type TokenSet,
} from './oauth';
export type {
    GoogleProviderOptions,
    GitLabProviderOptions,
    MicrosoftProviderOptions,
} from './oauth/providers';

// Authorization (roles & permissions)
export {
    createAuthorizer,
    type AuthorizerKit,
    type AuthorizerOptions,
    type UnauthorizedReason,
} from './authz';
export {
    createResourcePolicy, ResourceAuthorizationError,
    type ResourceAuthorizationCode, type ResourcePolicy, type ResourcePolicyOptions,
    type ResourcePolicyContext, type ResourceLookupContext,
} from './authz/resource-policy';

// Second factors: authenticator-app codes and recovery codes. Passkeys: `@cossackframework/auth/passkeys`.
export {
    base32Encode, base32Decode, generateTotpSecret, totpUri, totpStep, totpCode, verifyTotp, generateRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode,
    type TotpOptions,
} from './two-factor';
