export interface CossackServerRuntime {
    onClientMessage(client: unknown, message: string): Promise<void>;
    broadcastState(partialState: Record<string, any>): void;
    broadcastEvent(eventName: string, payload: any[]): void;
    sendClientAction(client: unknown, action: string, payload: any[]): void;
    persistState(): Promise<void>;
}
