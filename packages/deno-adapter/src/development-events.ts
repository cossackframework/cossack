import { WebSocketServer, WebSocket } from 'ws';
import { createServerModuleRunnerTransport, type NormalizedServerHotChannel } from 'vite';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** Private runner events, separate from application sockets and module HTTP calls. */
export function connectDenoDevelopmentEvents(
  control: Server,
  channel: NormalizedServerHotChannel,
  token: string,
): () => Promise<void> {
  const events = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    if (request.url !== '/events' || request.headers['sec-websocket-protocol'] !== `cossack-deno-${token}`) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    events.handleUpgrade(request, socket, head, (connection) => {
      const transport = createServerModuleRunnerTransport({
        channel,
      });
      connection.on('error', () => connection.terminate());
      connection.once('close', () => {
        void transport.disconnect?.();
      });
      connection.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());
          if (payload?.type === 'ping') return;
          if (payload?.type !== 'custom' || typeof payload.event !== 'string') {
            connection.close(1008, 'Invalid runner event');
            return;
          }
          void Promise.resolve(transport.send?.(payload)).catch(() => connection.terminate());
        } catch {
          connection.close(1008, 'Invalid runner event');
        }
      });
      void transport.connect?.({
        onMessage(payload) {
          // This adapter replaces the process on edits. Do not also ask the
          // runner to re-evaluate application modules in the retiring process.
          if ((payload.type === 'custom' || payload.type === 'connected') && connection.readyState === WebSocket.OPEN)
            connection.send(JSON.stringify(payload));
        },
        onDisconnection() {
          connection.close();
        },
      });
    });
  };
  control.on('upgrade', upgrade);
  return async () => {
    control.off('upgrade', upgrade);
    for (const connection of events.clients) connection.terminate();
    await new Promise<void>((resolve) => events.close(() => resolve()));
  };
}
