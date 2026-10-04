import type { Context } from 'hono';
import type { Cossack } from './cossack';
import type { PageOptions } from './decorators';

export interface RuntimeWebSocketUpgrade {
  /** Process-local instance key computed by the framework during SSR. */
  target: string;
  provider: string;
  componentId: string;
  pathname: string;
  user?: unknown;
  /** This peer's verified upgrade context, with decoded page route params. */
  context?: Context;
  env: Record<string, unknown>;
  createComponent(): Promise<Cossack>;
}

/** Runtime extension point. Routing, auth, origin checks and scope remain framework-owned. */
export interface CossackRuntimeAdapter {
  readonly name: string;
  /** Transports this runtime can execute. Omit to preserve legacy behavior. */
  readonly supportedTransports?: readonly PageOptions['transport'][];
  getClientMetadata?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  handleWebSocketUpgrade?(
    context: Context,
    upgrade: RuntimeWebSocketUpgrade,
  ): Response | Promise<Response>;
}
