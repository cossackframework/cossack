// src/shared/decorators.ts
import 'reflect-metadata';
import type { MiddlewareHandler } from 'hono';
import { isServer } from './environment';

export type Middleware = MiddlewareHandler;

export interface PageOptions {
  middlewares?: Middleware[];
}

export function Page(options: PageOptions = {}): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata('page:options', options, target);
  };
}

const noop = () => {};

/**
 * A "universal" decorator that marks a method or property as server-only.
 * This decorator attaches metadata, and the Cossack base class handles the logic
 * of replacing the member with a WebSocket proxy on the client.
 */
export function Server(): any {
  return (target: any, propertyKey: string | symbol) => {
    const serverOnlyKeys = Reflect.getMetadata('cossack:server-only', target.constructor) || [];
    Reflect.defineMetadata('cossack:server-only', [...serverOnlyKeys, propertyKey], target.constructor);
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

export function State(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const stateKeys = Reflect.getMetadata('cossack:state', target.constructor) || [];
    Reflect.defineMetadata('cossack:state', [...stateKeys, propertyKey], target.constructor);
  };
}

export function Computed(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('computed', true, target, propertyKey);
    return descriptor;
  };
}