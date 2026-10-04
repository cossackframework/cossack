// Session-based authentication
export {
    createAuth,
    type AuthKit,
    type AuthProvider,
    type LoginHandlerOptions,
    type SessionCreator,
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
