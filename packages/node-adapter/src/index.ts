export { serveStatic, createStaticAssets, type StaticServeOptions } from './static-serve';
export {
    createNodeEmailSender,
    type NodeEmailOptions,
    type NodeEmailSender,
    type EmailMessageInput,
    type EmailSendResult,
    type EmailAddress,
} from './email';

export { createNodeAdapter, DEFAULT_WEBSOCKET_MAX_PAYLOAD, type NodeAdapterOptions, type NodeWebSocketUpgrade, type NodeUpgradeServer } from './adapter';

export { installNodeShutdown, type NodeShutdownServer, type NodeShutdownOptions, type NodeShutdownResult } from './shutdown';
