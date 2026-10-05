import { beginDevelopmentSocketDispatch } from './development-socket-dispatch';
import { logRuntimeFailure } from './server-diagnostics';
import { rpcCancellations, sendRpcFrame, type RpcStreamFrame } from './rpc-stream';
import { closeUnauthorizedSocket, SocketDeliveryQueue, type SocketOperationAuthorizer } from './socket-delivery';
import type { Context } from 'hono';

export { closeUnauthorizedSocket } from './socket-delivery';

export interface CossackServerRuntime {
    onClientMessage(client: unknown, message: string): Promise<void>;
    broadcastState(partialState: Record<string, any>): void;
    broadcastEvent(eventName: string, payload: any[]): void;
    sendClientAction(client: unknown, action: string, payload: any[]): void;
    persistState(): Promise<void>;
}

/**
 * Shared WebSocket RPC dispatch. Actions carry a request id when the caller
 * expects correlated yield/done/error frames; `cancel` messages terminate a
 * request-scoped generator through the per-socket cancellation hook.
 */
export async function dispatchSocketRpcMessage(
    root: any,
    data: unknown,
    client: unknown,
    getUser?: (client: any) => unknown,
    getContext?: (client: any) => Context | undefined,
    authorize?: (client: any, operation: (context: Context) => Promise<void>) => Promise<boolean>,
): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.type === 'cancel') {
        if (typeof message.requestId === 'string') rpcCancellations(client).get(message.requestId)?.();
        return;
    }
    if (message.type !== 'action') return;
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
    const development = import.meta.env?.DEV ? beginDevelopmentSocketDispatch(message.developmentTrace, requestId) : undefined;
    const send = (frame: RpcStreamFrame) => sendRpcFrame(client, frame, import.meta.env?.DEV ? development?.frame : undefined);
    if (typeof message.action !== 'string' || !message.action.trim() || !Array.isArray(message.payload) ||
        (message.target !== undefined && (typeof message.target !== 'string' || !message.target.trim()))) {
        if (requestId?.trim()) send({ v: 1, type: 'error', requestId,
            code: 'COSSACK_RPC_REQUEST_INVALID', message: 'Invalid RPC action request.' });
        return;
    }
    const user = getUser?.(client);

    let targetInstance = root;
    const target = message.target;
    if (typeof target === 'string' && target !== targetInstance._id) {
        targetInstance = root.activeComponents?.get?.(target);
        if (!targetInstance) {
            logRuntimeFailure({ requestId }, 'dispatch');
            if (requestId !== undefined) send({ v: 1, type: 'error', requestId,
                code: 'COSSACK_RPC_NOT_FOUND', message: `Target component '${target}' not found.` });
            return;
        }
    }
    const execute = async (actionUser = user, context = getContext?.(client)) => {
        if (development) await targetInstance.executeAction(message.action, message.payload, actionUser, client, requestId, context, development);
        else if (context) await targetInstance.executeAction(message.action, message.payload, actionUser, client, requestId, context);
        else await targetInstance.executeAction(message.action, message.payload, actionUser, client, requestId);
    };
    if (!authorize) {
        await execute();
        return;
    }
    let operationRan = false;
    let actionFailed = false;
    let allowed = false;
    try {
        allowed = await authorize(client, async context => {
            operationRan = true;
            try { await execute(context.get('user'), context); }
            catch (error) { actionFailed = true; throw error; }
        });
    } catch (error) {
        if (actionFailed) throw error;
        logRuntimeFailure({ requestId }, 'authentication');
    }
    if (allowed && operationRan) return;
    const authChanged = 'Realtime authorization changed. Reload the page to reconnect.';
    if (requestId?.trim()) send({ v: 1, type: 'error', requestId,
        code: 'COSSACK_REALTIME_AUTH_CHANGED', message: authChanged });
    closeUnauthorizedSocket(client as any);
}

/** Minimal socket surface shared by process runtimes such as Node and Deno. */
export interface InMemoryWebSocketClient {
    readonly readyState: number;
    send(data: string): void;
    close?(code?: number, reason?: string): void;
}

export interface InMemoryWebSocketRuntimeOptions<Client extends InMemoryWebSocketClient> {
    getUser?: (client: Client) => unknown;
    getContext?: (client: Client) => Context | undefined;
    isOpen?: (client: Client) => boolean;
    onError?: (error: unknown) => void;
    authorize?: SocketOperationAuthorizer<Client>;
}

/**
 * Runtime-neutral, process-local WebSocket engine.
 *
 * Platform adapters own upgrades and socket event wiring; this class owns the
 * Cossack protocol, nested-component dispatch, per-client authentication and
 * fan-out semantics. It deliberately does not persist state.
 */
export class InMemoryWebSocketRuntime<
    Client extends InMemoryWebSocketClient = InMemoryWebSocketClient,
> implements CossackServerRuntime {
    protected readonly clients = new Set<Client>();
    protected readonly component: any;
    private readonly users = new WeakMap<object, unknown>();
    private readonly contexts = new WeakMap<object, Context>();
    private readonly authorizers = new WeakMap<object, SocketOperationAuthorizer<Client>>();
    private readonly options: InMemoryWebSocketRuntimeOptions<Client>;
    private readonly delivery = new SocketDeliveryQueue<Client>();

    constructor(component: any, options: InMemoryWebSocketRuntimeOptions<Client> = {}) {
        this.component = component;
        this.options = options;
        this.component._runtime = this;
    }

    addClient(client: Client, user?: unknown, context?: Context, authorize?: SocketOperationAuthorizer<Client>): void {
        this.clients.add(client);
        if (typeof client === 'object' && client !== null) {
            this.users.set(client, user);
            if (context) this.contexts.set(client, context);
            if (authorize) this.authorizers.set(client, authorize);
        }
    }

    removeClient(client: Client): void {
        for (const cancel of rpcCancellations(client).values()) cancel();
        rpcCancellations(client).clear();
        this.clients.delete(client);
        if (typeof client === 'object' && client !== null) {
            this.users.delete(client);
            this.contexts.delete(client);
            this.authorizers.delete(client);
        }
        this.delivery.remove(client);
    }

    get clientCount(): number {
        return this.clients.size;
    }

    getInitialState(): unknown {
        return this.component.getInitialState();
    }

    /** WebSocket snapshots use the same flat public record as later broadcasts. */
    getPublicState(): Record<string, unknown> {
        const initial = this.component.getInitialState();
        if (!initial?.public || typeof initial.public !== 'object' || Array.isArray(initial.public)) {
            throw new Error('[Cossack] A WebSocket component must provide a public state record.');
        }
        return initial.public;
    }

    async onClientMessage(client: unknown, message: string): Promise<void> {
        const socket = client as Client;
        if (message === 'ping') {
            if (this.isOpen(socket)) socket.send('pong');
            return;
        }

        let data: any;
        try {
            data = JSON.parse(message);
        } catch (error) {
            this.options.onError?.(error);
            return;
        }
        const authorizer = (candidate: unknown) => typeof candidate === 'object' && candidate !== null
            ? this.authorizers.get(candidate) ?? this.options.authorize : this.options.authorize;
        const authorize = authorizer(socket);
        await dispatchSocketRpcMessage(this.component, data, socket, candidate =>
            this.options.getUser?.(candidate as Client) ??
            (typeof candidate === 'object' && candidate !== null ? this.users.get(candidate) : undefined), candidate =>
            this.options.getContext?.(candidate as Client) ??
            (typeof candidate === 'object' && candidate !== null ? this.contexts.get(candidate) : undefined),
            authorize ? (_candidate, operation) => authorize(socket, operation) : undefined);
    }

    broadcastState(partialState: Record<string, any>): void {
        this.broadcast({ type: 'state-update', state: partialState });
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        this.broadcast({ type: 'event', eventName, payload });
    }

    sendClientAction(client: unknown, action: string, payload: any[]): void {
        const socket = client as Client;
        void this.sendToClient(socket, { type: 'client-action', action, payload });
    }

    async sendInitialState(client: Client): Promise<void> {
        await this.sendToClient(client, { type: 'state-update', state: this.getPublicState() });
    }

    async sendToClient(client: Client, message: Record<string, unknown>): Promise<void> {
        const authorizer = typeof client === 'object' && client !== null ? this.authorizers.get(client) : undefined;
        await this.delivery.send(client, JSON.stringify(message), candidate => this.isOpen(candidate),
            authorizer ?? this.options.authorize, error => this.options.onError?.(error));
    }

    async persistState(): Promise<void> {
        // Process runtimes are intentionally ephemeral. Applications persist
        // durable data through the database package.
    }

    protected isOpen(client: Client): boolean {
        return this.options.isOpen?.(client) ?? client.readyState === 1;
    }

    private broadcast(message: Record<string, unknown>): void {
        const encoded = JSON.stringify(message);
        for (const client of this.clients) {
            const authorizer = typeof client === 'object' && client !== null ? this.authorizers.get(client) : undefined;
            void this.delivery.send(client, encoded, candidate => this.isOpen(candidate),
                authorizer ?? this.options.authorize, error => this.options.onError?.(error));
        }
    }
}
