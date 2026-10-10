import type { CossackRuntimeAdapter, PageOptions } from '@cossackframework/core';
export type { CossackRuntimeAdapter, RuntimeWebSocketUpgrade } from '@cossackframework/core';

export function assertRuntimeTransportSupport(
  adapter: CossackRuntimeAdapter | undefined,
  pageOptions: PageOptions | undefined,
): void {
  const transport = pageOptions?.transport ?? 'http';
  if (adapter?.supportedTransports && !adapter.supportedTransports.includes(transport)) {
    throw new Error(
      `[Cossack] The ${adapter.name} runtime does not support the "${transport}" transport. ` +
      `Supported transports: ${adapter.supportedTransports.join(', ')}.`,
    );
  }
  if (adapter && pageOptions?.transport === 'durable-object' && pageOptions.stateful === true) {
    throw new Error(
      `[Cossack] ${adapter.name} WebSockets are process-local and do not support stateful: true. ` +
      'Persist durable state through a database or deploy with Cloudflare Durable Objects.',
    );
  }
}
