import type { Cossack } from './cossack';
import type { DurableObjectId, DurableObjectNamespace } from '@cloudflare/workers-types';

export abstract class StateProvider {
  // This will be set by the Cossack instance after it's constructed.
  public component!: Cossack<any>;
  public env!: any;

  public setContext(component: Cossack<any>, env: any) {
    this.component = component;
    this.env = env;
  }

  /**
   * Returns the target for the WebSocket connection (e.g. a Durable Object ID).
   */
  abstract getConnectionTarget(): { toString(): string } | string | undefined | unknown;
}

export class PageStateProvider extends StateProvider {
  getConnectionTarget(): unknown {
    const { page } = this.component.props;
    if (!page) {
      throw new Error('Could not determine page for PageStateProvider. Ensure `page` is in component props.');
    }
    const durableObjectName = Reflect.getMetadata('cossack:durable-object-name', this.component.constructor);
    if (!durableObjectName) {
      throw new Error('Durable object name not found for component. Make sure to register it in your AppDurableObject.');
    }
    const durableObject = this.env[durableObjectName] as DurableObjectNamespace;
    if (!durableObject) {
        throw new Error(`Durable Object namespace '${durableObjectName}' not found in environment bindings.`);
    }
    return durableObject.idFromName(page);
  }
}