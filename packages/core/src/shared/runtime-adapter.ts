import type { Context } from 'hono';
import type { Cossack } from './cossack';
import type { PageOptions } from './decorators';

export interface RuntimeWebSocketUpgrade {
  /** Process-local instance key, recomputed by the framework from the page identity or scope key. */
  target: string;
  componentId: string;
  pathname: string;
  user?: unknown;
  /** This peer's verified upgrade context, with decoded page route params. */
  context?: Context;
  /** Revalidate the peer and execute the supplied operation in a fresh request scope. */
  authorize?: (operation: (context: Context) => Promise<void>) => Promise<boolean>;
  /** Accept and immediately send the terminal authorization frame; skip component bootstrap. */
  rejectAuthorization?: boolean;
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
