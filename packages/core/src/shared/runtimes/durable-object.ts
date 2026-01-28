import type { CossackServerRuntime } from '../runtime';
import type { Cossack } from '../cossack';

export class DurableObjectRuntime implements CossackServerRuntime {
    private component: Cossack;
    private state: DurableObjectState;

    constructor(component: Cossack, state: DurableObjectState) {
        this.component = component;
        this.state = state;
        (this.component as any)._runtime = this;
    }

    async onClientMessage(client: WebSocket, message: string): Promise<void> {
        const data = JSON.parse(message);
        if (data.type === 'action') {
            const { user } = (client as any).deserializeAttachment() as any;
            
            let targetInstance = this.component;
            if (data.target && data.target !== targetInstance._id) {
                if (targetInstance.activeComponents.has(data.target)) {
                    targetInstance = targetInstance.activeComponents.get(data.target)!;
                } else {
                    console.warn(`[Cossack] Target component '${data.target}' not found. Action '${data.action}' dropped.`);
                    return;
                }
            }

            await targetInstance.executeAction(data.action, data.payload, user, client);
        }
    }

    broadcastState(partialState: Record<string, any>): void {
        const message = JSON.stringify({ type: 'state-update', state: partialState });
        for (const ws of this.state.getWebSockets()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        const message = JSON.stringify({ type: 'event', eventName, payload });
        for (const ws of this.state.getWebSockets()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    sendClientAction(client: WebSocket, action: string, payload: any[]): void {
        const message = JSON.stringify({ type: 'client-action', action, payload });
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }

    async persistState(): Promise<void> {
        const stateToPersist = this.component.getInitialState();
        await this.state.storage.put('componentState', stateToPersist);
    }
}
