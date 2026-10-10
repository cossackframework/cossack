import type { BrowserDevTools } from './devtools.js';

/** Used only by the opt-in Vite virtual module. Acknowledgements bound outstanding snapshots. */
export function connectDevelopmentTraceBridge(token: string, hot: ImportMeta['hot'], tools: BrowserDevTools | undefined): () => void {
    if (!import.meta.env.DEV || !hot) return () => {};
    let connected = true, request = 0, pending: string | undefined, pendingStopped: string | undefined, lastStopped: string | undefined, disposed = false;
    const event = 'cossack:development-trace';
    const publish = () => {
        if (disposed || !connected || pending || !tools) return;
        const snapshot = tools.snapshot();
        if (!snapshot || !snapshot.collecting && snapshot.sessionId === lastStopped) return;
        const json = JSON.stringify(snapshot);
        if (new TextEncoder().encode(json).length > 2 * 1024 * 1024) return;
        pending = String(++request); pendingStopped = snapshot.collecting ? undefined : snapshot.sessionId;
        hot.send(event, { token, id: pending, json });
        // Only an acknowledged stopped record suppresses subsequent sends.
    };
    const ack = (data: { id: string; status: string }) => {
        if (data?.id !== pending) return;
        pending = undefined;
        if (data.status === 'saved') {
            lastStopped = pendingStopped;
        }
    };
    const native = (json: unknown) => { if (!disposed && connected) tools?.recordNativeEvidence(json); };
    hot.on(event + ':native', native);
    const disconnect = () => { connected = false; pending = undefined; };
    const reconnect = () => { connected = true; pending = undefined; publish(); };
    hot.on(event + ':ack', ack); hot.on('vite:ws:disconnect', disconnect); hot.on('vite:ws:connect', reconnect);
    const timer = setInterval(publish, 1000);
    const dispose = () => {
        if (disposed) return; disposed = true; clearInterval(timer);
        hot.off(event + ':native', native); hot.off(event + ':ack', ack); hot.off('vite:ws:disconnect', disconnect); hot.off('vite:ws:connect', reconnect);
        window.removeEventListener('pagehide', pagehide);
    };
    const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) dispose(); };
    window.addEventListener('pagehide', pagehide);
    hot.dispose(dispose);
    return dispose;
}
