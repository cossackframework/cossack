// src/shared/decorators.ts
import 'reflect-metadata';
import type { MiddlewareHandler } from 'hono';
import { isServer } from './environment';
import { CossackOptions } from './cossack';
import { StateProvider } from './StateProvider';
import { createRef } from './ref';
import { ValidationRule, ValidationConfig, ValidationRulesStore, setValidationRules } from './validation';

export type Middleware = MiddlewareHandler;
export type CossackTransport = 'durable-object' | 'websocket' | 'http';

export interface PageOptions {
  middlewares?: Middleware[];
  channels?: string[];
  providers?: { [key: string]: StateProvider };
  transport?: CossackTransport;
  route?: string;
  ssg?: boolean | SsgOptions;
  stateful?: boolean;
}

export interface SsgOptions {
  enabled?: boolean;
  generateStaticParams?: () => Promise<Record<string, string>[]>;
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

/**
 * Decorator for reusable components. 
 * Currently behaves like @Page but semantic distinction is important for future tooling.
 */
export function Component(options: PageOptions = {}): ClassDecorator {
    return Page(options);
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

/**
 * Decorator for client-only state.
 * These properties trigger UI re-renders when changed on the client,
 * but are NEVER synchronized with the server.
 */
export function ClientState(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const clientStateProperties = Reflect.hasOwnMetadata('cossack:client-state', target.constructor)
      ? Reflect.getOwnMetadata('cossack:client-state', target.constructor)
      : new Set();
    
    (clientStateProperties as Set<string | symbol>).add(propertyKey);
    Reflect.defineMetadata('cossack:client-state', clientStateProperties, target.constructor);
  };
}

/**
 * Decorator for properties that are passed from a parent component.
 * Functionally equivalent to @ClientState (reactive, client-side only),
 * but semantically indicates an input.
 */
export function Prop(): PropertyDecorator {
  return ClientState();
}

export interface ValidateDecoratorOptions {
  rules?: ValidationRule;
  config?: ValidationConfig;
}

/**
 * Decorator for validating form fields.
 * Works with @State and @ClientState decorated properties.
 *
 * @example
 * ```typescript
 * @State()
 * @Validate({ required: true, email: true, message: 'Please enter a valid email' })
 * email = '';
 * ```
 */
export function Validate(options: ValidateDecoratorOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const propertyName = String(propertyKey);

    // Get existing validation rules or create new store
    const existingRules = Reflect.hasOwnMetadata('cossack:validation', target.constructor)
      ? Reflect.getOwnMetadata('cossack:validation', target.constructor)
      : {};

    // Merge with existing rules for this property (allows chaining with @Validate on same property)
    const existingPropertyRules = existingRules[propertyName]?.rules || {};
    const mergedRules = { ...existingPropertyRules, ...options.rules };

    // Store validation rules
    existingRules[propertyName] = {
      rules: mergedRules,
      config: {
        trigger: 'all',
        runOn: 'both',
        errorProperty: 'errors',
        debounce: 0,
        ...options.config,
      },
    };

    Reflect.defineMetadata('cossack:validation', existingRules, target.constructor);

    // Also mark this property as validated for the security plugin
    const validatedProperties = Reflect.hasOwnMetadata('cossack:validated-properties', target.constructor)
      ? Reflect.getOwnMetadata('cossack:validated-properties', target.constructor)
      : new Set<string>();

    (validatedProperties as Set<string>).add(propertyName);
    Reflect.defineMetadata('cossack:validated-properties', validatedProperties, target.constructor);
  };
}

export function Ref(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const privateKey = Symbol(String(propertyKey));

    Object.defineProperty(target, propertyKey, {
      get: function() {
        if (!this[privateKey]) {
          this[privateKey] = createRef();
        }
        return this[privateKey];
      },
      set: function(val) {
        this[privateKey] = val;
      },
      enumerable: true,
      configurable: true
    });
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

export function On(eventName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const domEvents = Reflect.getOwnMetadata('cossack:dom-events', target.constructor) || [];
    domEvents.push({ eventName, propertyKey });
    Reflect.defineMetadata('cossack:dom-events', domEvents, target.constructor);
    return descriptor;
  };
}

export interface EventListenerOptions {
  throttle?: number;
  debounce?: number;
}

export function OnDocument(eventName: string, options: EventListenerOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const documentEvents = Reflect.getOwnMetadata('cossack:document-events', target.constructor) || [];
    documentEvents.push({ eventName, propertyKey, options });
    Reflect.defineMetadata('cossack:document-events', documentEvents, target.constructor);
    return descriptor;
  };
}

export function OnWindow(eventName: string, options: EventListenerOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const windowEvents = Reflect.getOwnMetadata('cossack:window-events', target.constructor) || [];
    windowEvents.push({ eventName, propertyKey, options });
    Reflect.defineMetadata('cossack:window-events', windowEvents, target.constructor);
    return descriptor;
  };
}

export function Computed(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('computed', true, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for methods that are safe to run on both client and server.
 * This marks the method as shared, ensuring it is NOT stripped from the client bundle.
 *
 * Unlike @Server methods (which are stubbed on the client) and @Client methods (which are stubbed on the server),
 * @Shared methods retain their full implementation on both sides.
 *
 * Use this decorator for:
 * - Pure functions that don't access server-only resources
 * - Validation logic that needs to run consistently on both sides
 * - Data transformation utilities
 *
 * @example
 * ```ts
 * @Shared()
 * validateEmail(email: string): boolean {
 *   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 * }
 * ```
 */
export function Shared(): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        // Mark as server-callable (like @Server)
        const serverMethods = Reflect.hasOwnMetadata('cossack:server-methods', target.constructor)
            ? Reflect.getOwnMetadata('cossack:server-methods', target.constructor)
            : {};

        serverMethods[propertyKey] = {
            channel: 'global',
            provider: 'page',
        };
        Reflect.defineMetadata('cossack:server-methods', serverMethods, target.constructor);

        // Also mark as client-safe (like @Client) so it's NOT stubbed
        const clientMethods = Reflect.hasOwnMetadata('cossack:client-methods', target.constructor)
            ? Reflect.getOwnMetadata('cossack:client-methods', target.constructor)
            : {};

        clientMethods[propertyKey] = true;
        Reflect.defineMetadata('cossack:client-methods', clientMethods, target.constructor);

        // Mark as shared for the security plugin to detect
        Reflect.defineMetadata('cossack:shared', true, target, propertyKey);

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

export function Task(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const tasks = Reflect.getOwnMetadata('cossack:tasks', target.constructor) || [];
    tasks.push(propertyKey);
    Reflect.defineMetadata('cossack:tasks', tasks, target.constructor);
    return descriptor;
  };
}

export interface VisibleTaskOptions {
    strategy?: 'intersection-observer' | 'document-ready';
    threshold?: number;
    selector?: string;
}

export function VisibleTask(options: VisibleTaskOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const visibleTasks = Reflect.getOwnMetadata('cossack:visible-tasks', target.constructor) || [];
    visibleTasks.push({ propertyKey, options });
    Reflect.defineMetadata('cossack:visible-tasks', visibleTasks, target.constructor);
    return descriptor;
  };
}

export function PreventNavigation(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('cossack:prevent-navigation', propertyKey, target.constructor);
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

/**
 * Options for the @Service decorator.
 */
export interface ServiceOptions {
  scope?: 'singleton' | 'transient';
}

/**
 * Decorator for service classes that can be injected via dependency injection.
 * Marks the class as injectable so the DI container can resolve it.
 *
 * @example
 * ```typescript
 * @Service()
 * export class PaymentService {
 *   @State() status: string = 'idle';
 *
 *   @Server()
 *   async processPayment(amount: number) {
 *     this.status = 'processing';
 *   }
 * }
 * ```
 */
export function Service(options: ServiceOptions = {}): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata('cossack:service', {
      scope: options.scope || 'singleton',
    }, target);
  };
}