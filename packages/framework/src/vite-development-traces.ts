import { parseDevelopmentNativeEvidence } from '@cossackframework/core/devtools';
import type { ViteDevServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { writeDevelopmentTrace } from './development-traces.js';
import { DEVELOPMENT_TRACE_MAX_BYTES } from './development-trace-record.js';

export const TRACE_BRIDGE_MODULE = 'virtual:cossack-development-traces';
export const TRACE_BRIDGE_EVENT = 'cossack:development-trace';
/** One pending write: excess clients get a retryable acknowledgement rather than an unbounded queue. */
export function installDevelopmentTraceBridge(server: ViteDevServer, root: string) {
    const serverId = randomUUID(), token = randomUUID();
    let pending = false, closed = false;
    const receive = (data: any, client: { send: (event: string, data: any) => void }) => {
        if (closed || !data || data.token !== token || typeof data.id !== 'string' || !/^[0-9]{1,12}$/.test(data.id)) return;
        const reply = (status: 'saved' | 'busy' | 'invalid' | 'unavailable') => { if (!closed) { try { client.send(TRACE_BRIDGE_EVENT + ':ack', { id: data.id, status }); } catch { /* Client disconnected after publishing. */ } } };
        if (typeof data.json !== 'string' || data.json.length > DEVELOPMENT_TRACE_MAX_BYTES) { reply('invalid'); return; }
        if (pending) { reply('busy'); return; }
        pending = true;
        void writeDevelopmentTrace(root, serverId, data.json).then(() => reply('saved'), () => reply('unavailable')).finally(() => { pending = false; });
    };
    server.ws.on(TRACE_BRIDGE_EVENT, receive);
    // Subscribe only to server runners. Browser messages cannot enter this receiver.
    const nativeEvent = TRACE_BRIDGE_EVENT + ':native';
    const environments = Object.values(server.environments ?? {}).filter(environment => environment.config.consumer === 'server');
    const native = (json: unknown, client: { send: (event: string, data: unknown) => void }) => {
        const evidence = parseDevelopmentNativeEvidence(json);
        if (closed || !evidence) return;
        try { server.ws.send(nativeEvent, json); } catch { /* Development client disconnected. */ }
        try { client.send(nativeEvent + ':ack', { dispatchId: evidence.dispatchId }); } catch { /* Runner disconnected. */ }
    };
    for (const environment of environments) environment.hot.on(nativeEvent, native);
    const dispose = () => { closed = true;
        for (const environment of environments) environment.hot.off(nativeEvent, native); server.ws.off(TRACE_BRIDGE_EVENT, receive); };
    server.httpServer?.once('close', dispose);
    return { token, dispose };
}
