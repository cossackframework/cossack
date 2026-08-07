export interface CossackServerRuntime {
    onClientMessage(client: unknown, message: string): Promise<void>;
    broadcastState(partialState: Record<string, any>): void;
    broadcastEvent(eventName: string, payload: any[]): void;
    sendClientAction(client: unknown, action: string, payload: any[]): void;
    persistState(): Promise<void>;
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
        if (!data || typeof data !== 'object' || data.type !== 'action' ||
            typeof data.action !== 'string' || !Array.isArray(data.payload)) return;

        let target = this.component;
        if (typeof data.target === 'string' && data.target !== target._id) {
            target = target.activeComponents?.get?.(data.target);
            if (!target) return;
        }

        const user = this.options.getUser?.(socket) ??
            (typeof socket === 'object' && socket !== null ? this.users.get(socket) : undefined);
        await target.executeAction(data.action, data.payload, user, socket);
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
