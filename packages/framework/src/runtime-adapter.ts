import type { Context } from 'hono';
import type { Cossack } from '@cossackframework/core';
import type { PageOptions } from '@cossackframework/core';

export interface RuntimeWebSocketUpgrade {
  /** Process-local instance key computed by the framework during SSR. */
  target: string;
  provider: string;
  componentId: string;
  pathname: string;
  user?: unknown;
  env: Record<string, unknown>;
  createComponent(): Promise<Cossack>;
}

/** Runtime extension point. Routing, auth, origin checks and scope remain framework-owned. */
export interface CossackRuntimeAdapter {
  readonly name: string;
  getClientMetadata?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  handleWebSocketUpgrade?(
    context: Context,
    upgrade: RuntimeWebSocketUpgrade,
  ): Response | Promise<Response>;
}

export function assertRuntimeTransportSupport(
  adapter: CossackRuntimeAdapter | undefined,
  pageOptions: PageOptions | undefined,
): void {
  if (adapter && pageOptions?.transport === 'durable-object' && pageOptions.stateful === true) {
    throw new Error(
      `[Cossack] ${adapter.name} WebSockets are process-local and do not support stateful: true. ` +
      'Persist durable state through a database or deploy with Cloudflare Durable Objects.',
    );
  }
}
