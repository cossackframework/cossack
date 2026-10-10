import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { ServerHttp2Session } from 'node:http2';
import type { Socket } from 'node:net';

/** Operations shared by Node HTTP, HTTPS and HTTP/2 compatibility servers. */
export interface NodeShutdownServer extends Pick<EventEmitter, 'on' | 'off'> {
  close(callback: () => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}
export interface NodeShutdownOptions {
  /** Deadline for HTTP requests and runtime cleanup together. Default: 10 seconds. */
  timeoutMs?: number;
  dispose(): Promise<void>;
  /** Called once after draining or the deadline. Signal handlers do not call process.exit. */
  onComplete?: (result: NodeShutdownResult) => void;
}
export interface NodeShutdownResult {
  forced: boolean;
  cleanupCompleted: boolean;
  cleanupFailed: boolean;
}

/** Explicit process ownership: stop accepting HTTP, dispose the runtime, and bound draining. */
export function installNodeShutdown(server: NodeShutdownServer, options: NodeShutdownOptions) {
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('Shutdown timeout must be positive and finite');
  const sockets = new Set<Socket>();
  const sessions = new Set<ServerHttp2Session>();
  let completion: Promise<NodeShutdownResult> | undefined;
  const connected = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const sessionOpened = (session: ServerHttp2Session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
    if (completion) session.close();
  };
  const responded = (_request: IncomingMessage, response: ServerResponse) => {
    response.once('finish', () => {
      if (completion) setImmediate(() => server.closeIdleConnections?.());
    });
  };
  const uninstall = () => {
    process.off('SIGTERM', signalled);
    process.off('SIGINT', signalled);
    server.off('connection', connected);
    server.off('request', responded);
    server.off('session', sessionOpened);
  };
  const shutdown = (): Promise<NodeShutdownResult> => completion ??= (async () => {
    let cleanupCompleted = false, cleanupFailed = false;
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeIdleConnections?.();
    for (const session of sessions) session.close();
    const cleanup = Promise.resolve().then(() => options.dispose()).then(
      () => { cleanupCompleted = true; },
      () => { cleanupCompleted = true; cleanupFailed = true; },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const forced = await Promise.race([
      Promise.all([closed, cleanup]).then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), timeout); }),
    ]);
    clearTimeout(timer);
    if (forced) {
      server.closeAllConnections?.();
      // Includes upgraded sockets, which closeAllConnections deliberately excludes.
      for (const session of sessions) session.destroy();
      for (const socket of sockets) socket.destroy();
    }
    sockets.clear();
    sessions.clear();
    uninstall();
    const result = { forced, cleanupCompleted, cleanupFailed };
    options.onComplete?.(result);
    return result;
  })();
  const signalled = () => { void shutdown(); };
  server.on('connection', connected);
  server.on('request', responded);
  server.on('session', sessionOpened);
  process.on('SIGTERM', signalled);
  process.on('SIGINT', signalled);
  return { shutdown, uninstall };
}
