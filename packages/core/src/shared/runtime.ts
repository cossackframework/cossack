import { rpcCancellations, sendRpcFrame } from './rpc-stream';

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
): Promise<void> {
    if (!data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.type === 'cancel') {
        if (typeof message.requestId === 'string') rpcCancellations(client).get(message.requestId)?.();
        return;
    }
    if (message.type !== 'action') return;
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
    if (typeof message.action !== 'string' || !message.action.trim() || !Array.isArray(message.payload) ||
        (message.target !== undefined && (typeof message.target !== 'string' || !message.target.trim()))) {
        if (requestId?.trim()) sendRpcFrame(client, { v: 1, type: 'error', requestId,
            code: 'COSSACK_RPC_REQUEST_INVALID', message: 'Invalid RPC action request.' });
        return;
    }
    const user = getUser?.(client);

    let targetInstance = root;
    const target = message.target;
    if (typeof target === 'string' && target !== targetInstance._id) {
        targetInstance = root.activeComponents?.get?.(target);
        if (!targetInstance) {
            console.warn(`[Cossack] Target component '${target}' not found. Action '${message.action}' dropped.`);
            if (requestId !== undefined) sendRpcFrame(client, { v: 1, type: 'error', requestId,
                code: 'COSSACK_RPC_NOT_FOUND', message: `Target component '${target}' not found.` });
            return;
        }
    }
    await targetInstance.executeAction(message.action, message.payload, user, client, requestId);
}

/** Minimal socket surface shared by process runtimes such as Node and Deno. */
export interface InMemoryWebSocketClient {
    readonly readyState: number;
    send(data: string): void;
}

export interface InMemoryWebSocketRuntimeOptions<Client extends InMemoryWebSocketClient> {
    getUser?: (client: Client) => unknown;
    isOpen?: (client: Client) => boolean;
    onError?: (error: unknown) => void;
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
    private readonly options: InMemoryWebSocketRuntimeOptions<Client>;

    constructor(component: any, options: InMemoryWebSocketRuntimeOptions<Client> = {}) {
        this.component = component;
        this.options = options;
        this.component._runtime = this;
    }

    addClient(client: Client, user?: unknown): void {
        this.clients.add(client);
        if (typeof client === 'object' && client !== null) this.users.set(client, user);
    }

    removeClient(client: Client): void {
        this.clients.delete(client);
        if (typeof client === 'object' && client !== null) this.users.delete(client);
    }

    get clientCount(): number {
        return this.clients.size;
    }

    getInitialState(): unknown {
        return this.component.getInitialState();
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
        await dispatchSocketRpcMessage(this.component, data, socket, candidate =>
            this.options.getUser?.(candidate as Client) ??
            (typeof candidate === 'object' && candidate !== null ? this.users.get(candidate) : undefined));
    }

    broadcastState(partialState: Record<string, any>): void {
        this.broadcast({ type: 'state-update', state: partialState });
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        this.broadcast({ type: 'event', eventName, payload });
    }

    sendClientAction(client: unknown, action: string, payload: any[]): void {
        const socket = client as Client;
        if (this.isOpen(socket)) socket.send(JSON.stringify({ type: 'client-action', action, payload }));
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
            if (this.isOpen(client)) client.send(encoded);
        }
    }
}
