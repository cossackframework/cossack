// src/index.ts
export { RPC_JSON_RESPONSE_MAX_BYTES } from './shared/rpc-json';
export * from './shared/cossack';
export * from './shared/decorators';
export * from './shared/environment';
export * from './shared/StateProvider';
export type { User } from './shared/user';
export * from './shared/head';
export * from './shared/runtime';
export * from './shared/runtime-capabilities';
export * from './shared/storage-capabilities';
export * from './shared/image';
export * from './shared/ref';
export * from './shared/validation';
export * from './shared/input-schema';
export * from './shared/action-input';
export * from './shared/action-authorization';
export * from './shared/store';
export * from './shared/forms';
export * from './shared/crypto';
export * from './shared/flash';
export * from './shared/server-resource';
export * from './shared/task';
export { optimistic, OptimisticEditError, type OptimisticEdits } from './shared/optimistic';
export * from './shared/request-context';
export { cookie } from './shared/cookie';
export type { CookieOptions } from './shared/cookie';
export { createCossackContext } from './shared/context';
export type { CossackContext, GetFormDataOptions, FlashOptions } from './shared/context';
export * from './shared/runtimes/durable-object';
export * from './shared/runtimes/sse';
export * from './shared/container';
export * from './shared/service-bootstrap';
export * from './shared/service-scope';
export * from './shared/cossack-service';
export * from './shared/middleware';
export { isRpcCallableAction, sanitizeClientState } from './shared/method-proxy';
export { isOriginAllowed } from './shared/origin-security';
export * from './shared/rate-limit';
export * from './shared/i18n';
export { ActionValidationError, ClientVisibleError, isActionValidationError, isClientVisibleError } from './shared/errors';
export * from './shared/rpc-stream';

export * from './client/navigation';
export * from './shared/url-state';

export { CossackDurableObject } from './shared/CossackDurableObject';
export type { SocketPeerAttachment, SocketRequestSnapshot } from './shared/socket-context';
export {
    focusTrap,
    focusFirst,
    focusLast,
    focusNext,
    getTabbable,
} from './shared/focus-trap';
export {
    createStore,
    connectStore,
    type ReactiveStore,
} from './shared/reactive-store';
export {
    html,
    svg,
    nothing,
    TemplateResult,
    css,
    unsafeCSS,
    CSSResult,
} from '@cossackframework/renderer';
export type {
    SVGTemplateResult,
    ValueSanitizer,
    SanitizerFactory,
    CSSResultGroup,
} from '@cossackframework/renderer';

export { createRouteBuilder, routeParameters, RouteUrlError, type RouteBuilder, type RouteParameters, type RouteParameter } from './shared/routes';

export type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from './shared/runtime-adapter';
