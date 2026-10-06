import type { ViteDevServer } from 'vite';

/** Keep reload control public without sending the server's filesystem identity. */
export function installPublicReloadPrivacy(server: Pick<ViteDevServer, 'ws'>): () => void {
  const original = server.ws.send;
  const send = ((...args: unknown[]) => {
    const payload = args[0];
    if (payload && typeof payload === 'object' && 'type' in payload
      && payload.type === 'full-reload' && 'triggeredBy' in payload) {
      const publicPayload: Record<string, unknown> = { ...payload };
      delete publicPayload.triggeredBy;
      args[0] = publicPayload;
    }
    // Only the browser WebSocket channel is wrapped. ModuleRunner hot channels
    // keep their native compiler diagnostics and original payload objects.
    return Reflect.apply(original, server.ws, args);
  }) as typeof original;
  server.ws.send = send;
  return () => { if (server.ws.send === send) server.ws.send = original; };
}
