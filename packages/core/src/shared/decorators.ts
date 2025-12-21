// src/shared/decorators.ts
import 'reflect-metadata';
import type { MiddlewareHandler } from 'hono';
import { isServer } from './environment';
import { CossackOptions } from './cossack';
import { StateProvider } from './StateProvider';

export type Middleware = MiddlewareHandler;
export type CossackTransport = 'durable-object' | 'websocket' | 'http';

export interface PageOptions {
  middlewares?: Middleware[];
  channels?: string[];
  providers?: { [key: string]: StateProvider };
  transport?: CossackTransport;
  route?: string;
}

export function Page(options: PageOptions = {}): ClassDecorator {
  return (target: object) => {
    const existingOptions = Reflect.hasOwnMetadata('page:options', target)
      ? Reflect.getOwnMetadata('page:options', target)
      : {};

    const mergedOptions: PageOptions = {
      transport: 'http',
      ...existingOptions,
      ...options,
    };

    // Ensure 'global' is always a channel if channels are defined
    if (mergedOptions.channels && !mergedOptions.channels.includes('global')) {
      mergedOptions.channels.unshift('global');
    } else if (!mergedOptions.channels) {
      mergedOptions.channels = ['global'];
    }
    Reflect.defineMetadata('page:options', mergedOptions, target);
  };
}

const noop = () => {};

export interface ServerOptions {
  channel?: string;
  provider?: string;
}

/**
 * A "universal" decorator that marks a method or property as server-only.
 * This decorator attaches metadata, and the Cossack base class handles the logic
 * of replacing the member with a WebSocket proxy on the client.
 */
export function Server(options: ServerOptions = {}): any {
  return (target: any, propertyKey: string | symbol) => {
    const serverMethods = Reflect.hasOwnMetadata('cossack:server-methods', target.constructor)
      ? Reflect.getOwnMetadata('cossack:server-methods', target.constructor)
      : {};
    
    serverMethods[propertyKey] = {
      channel: options.channel || 'global',
      provider: options.provider || 'page',
    };
    Reflect.defineMetadata('cossack:server-methods', serverMethods, target.constructor);
  };
}

export interface ClientOptions {
  channel?: string;
}

export function Client(options: ClientOptions = {}): any {
  return (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
    const metadataStoreKey = 'cossack:client-methods';
    const existingMetadata = Reflect.hasOwnMetadata(metadataStoreKey, target.constructor)
      ? Reflect.getOwnMetadata(metadataStoreKey, target.constructor)
      : {};

    // The server needs the channel for proxying.
    // The client just needs a flag to know the method is callable.
    existingMetadata[propertyKey] = isServer
      ? { channel: options.channel || 'global' }
      : true;

    Reflect.defineMetadata(metadataStoreKey, existingMetadata, target.constructor);

    if (descriptor) {
      if (isServer) descriptor.value = noop;
      return descriptor;
    }
    if (isServer) {
      Object.defineProperty(target, propertyKey, {
        get: () => noop,
        set: noop,
        enumerable: true,
        configurable: true,
      });
    }
  };
}

export interface StateOptions {
  channel?: string;
  provider?: string;
}

export function State(options: StateOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const stateProperties = Reflect.hasOwnMetadata('cossack:state', target.constructor)
      ? Reflect.getOwnMetadata('cossack:state', target.constructor)
      : {};

    stateProperties[propertyKey] = {
      channel: options.channel || 'global',
      provider: options.provider || 'page',
    };
    Reflect.defineMetadata('cossack:state', stateProperties, target.constructor);
  };
}

export function OnEvent(eventName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const eventHandlers = Reflect.getOwnMetadata('cossack:event-handlers', target.constructor) || {};
    if (!eventHandlers[eventName]) {
      eventHandlers[eventName] = [];
    }
    eventHandlers[eventName].push(propertyKey);
    Reflect.defineMetadata('cossack:event-handlers', eventHandlers, target.constructor);
    return descriptor;
  };
}

export function Computed(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('computed', true, target, propertyKey);
    return descriptor;
  };
}

export function Optimistic(actionName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const optimisticHandlers = Reflect.getOwnMetadata('cossack:optimistic-handlers', target.constructor) || {};
    optimisticHandlers[actionName] = propertyKey;
    Reflect.defineMetadata('cossack:optimistic-handlers', optimisticHandlers, target.constructor);
    return descriptor;
  };
}

/**
 * (Optional) Creates typed versions of the @State and @Server decorators
 * for a specific component, providing compile-time safety and autocompletion
 * for channel names.
 */
export function createTypedDecorators<T extends CossackOptions>() {
  return {
    State: (options: StateOptions & { channel?: T['Channels'] | 'global' } = {}) => State(options),
    Server: (options: ServerOptions & { channel?: T['Channels'] | 'global' } = {}) => Server(options),
  };
}