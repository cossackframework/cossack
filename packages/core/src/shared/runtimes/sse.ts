import type { CossackServerRuntime } from '../runtime';
import type { Cossack } from '../cossack';

export interface SseConnection {
    write(data: string): void;
    close(): void;
}

class SseConnectionImpl implements SseConnection {
    private writer: WritableStreamDefaultWriter<Uint8Array>;
    private encoder: TextEncoder;
    private closed = false;

    constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
        this.writer = writer;
        this.encoder = new TextEncoder();
    }

    write(data: string): void {
        if (this.closed) return;
        this.writer.write(this.encoder.encode(data)).catch(() => {
            this.closed = true;
        });
    }

    close(): void {
        this.closed = true;
        this.writer.close().catch(() => {});
    }
}

export class SseRuntime implements CossackServerRuntime {
    private component: Cossack;
    private connections: Set<SseConnection> = new Set();

    constructor(component: Cossack) {
        this.component = component;
        (this.component as any)._runtime = this;
    }

    addConnection(writer: WritableStreamDefaultWriter<Uint8Array>): SseConnection {
        const connection = new SseConnectionImpl(writer);
        this.connections.add(connection);
        return connection;
    }

    removeConnection(connection: SseConnection): void {
        this.connections.delete(connection);
        connection.close();
    }

    async onClientMessage(_client: unknown, _message: string): Promise<void> {
        // SSE is one-directional (server → client).
        // Client messages come via HTTP POST (/crpc), not through SSE.
    }

    broadcastState(partialState: Record<string, any>): void {
        const data = JSON.stringify(partialState);
        const message = `event: state-update\ndata: ${data}\n\n`;
        for (const conn of this.connections) {
            conn.write(message);
        }
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        const data = JSON.stringify({ eventName, payload });
        const message = `event: event\ndata: ${data}\n\n`;
        for (const conn of this.connections) {
            conn.write(message);
        }
    }

    sendClientAction(_client: unknown, action: string, payload: any[]): void {
        const data = JSON.stringify({ action, payload });
        const message = `event: client-action\ndata: ${data}\n\n`;
        // Send to all connections (SSE doesn't have per-client identity)
        for (const conn of this.connections) {
            conn.write(message);
        }
    }

    async persistState(): Promise<void> {
        // No persistence for SSE — in-memory only
    }
}
