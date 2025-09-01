// src/shared/decorators.ts
import 'reflect-metadata';
import type { MiddlewareHandler } from 'hono';
import { isServer } from './environment';

export type Middleware = MiddlewareHandler;

export interface PageOptions {
  middlewares?: Middleware[];
  channels?: string[];
}

export function Page(options: PageOptions = {}): ClassDecorator {
  return (target: object) => {
    // Ensure 'global' is always a channel if channels are defined
    if (options.channels && !options.channels.includes('global')) {
      options.channels.unshift('global');
    } else if (!options.channels) {
      options.channels = ['global'];
    }
    Reflect.defineMetadata('page:options', options, target);
  };
}

const noop = () => {};

export interface ServerOptions {
  channel?: string;
}

/**
 * A "universal" decorator that marks a method or property as server-only.
 * This decorator attaches metadata, and the Cossack base class handles the logic
 * of replacing the member with a WebSocket proxy on the client.
 */
export function Server(options: ServerOptions = {}): any {
  return (target: any, propertyKey: string | symbol) => {
    const serverMethods = Reflect.getMetadata('cossack:server-methods', target.constructor) || {};
    serverMethods[propertyKey] = {
      channel: options.channel || 'global',
    };
    Reflect.defineMetadata('cossack:server-methods', serverMethods, target.constructor);
  };
}

export function Client(): any {
  return (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
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
}

export function State(options: StateOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const stateProperties = Reflect.getMetadata('cossack:state', target.constructor) || {};
    stateProperties[propertyKey] = {
      channel: options.channel || 'global',
    };
    Reflect.defineMetadata('cossack:state', stateProperties, target.constructor);
  };
}

export function Computed(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('computed', true, target, propertyKey);
    return descriptor;
  };
}
