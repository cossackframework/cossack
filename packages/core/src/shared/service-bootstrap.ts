// src/shared/service-bootstrap.ts
import 'reflect-metadata';
import { isService } from './container';
import { RESERVED_STATE_KEYS } from './component-types';

/**
 * Bootstrap a service instance: set up @State properties as simple
 * getters/setters on the service instance.
 *
 * Proxying of @Server methods is handled by the parent component's
 * _bootstrapServices(), not here.
 */
export function bootstrapService(
    instance: any,
): void {
    const stateProperties = Reflect.getMetadata('cossack:state', instance.constructor) || {};
    const stateKeys = Object.keys(stateProperties);

    if (stateKeys.length === 0) {
        return;
    }

    // Initialize @State properties as simple getters/setters.
    // The parent component handles re-renders via its RPC response handler.
    for (const key of stateKeys) {
        let value = instance[key];

        // Skip if property already has a reactive descriptor
        const descriptor = Object.getOwnPropertyDescriptor(instance, key);
        if (descriptor && descriptor.get && descriptor.set) {
            continue;
        }

        Object.defineProperty(instance, key, {
            get() {
                return value;
            },
            set(newValue: any) {
                value = newValue;
            },
            enumerable: true,
            configurable: true,
        });
    }
}

// ========== Component service bootstrap helpers ==========
// These functions are extracted from the Cossack class body and accept the
// component instance as the first argument. They access private component
// fields via `as any` casts — same pattern as bootstrapService() above.

/**
 * Bootstrap services injected via constructor parameters.
 * - Initializes @State reactive properties on services
 * - Registers service state on the component so RPC round-trips work
 * - Server: creates forwarding methods so `this.increment()` delegates to the service
 * - Client: creates HTTP fetch proxies for service @Server methods
 */
export function bootstrapServices(component: any): void {
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', component.constructor) || [];

    for (const dep of paramTypes) {
        if (isService(dep)) {
            const serviceInstance = findServiceInstance(component, dep);
            if (serviceInstance) {
                // Set up @State getters/setters on the service
                bootstrapService(serviceInstance);

                // Register service @State properties on the component so the
                // RPC mechanism (apply state → call action → getPublicState)
                // works transparently for service state.
                registerServiceState(component, serviceInstance);

                if (component.isServer) {
                    forwardServiceMethods(component, serviceInstance);
                } else {
                    proxyServiceMethods(component, serviceInstance);
                }
            }
        }
    }
}

/**
 * Register service @State properties on the component's state container
 * and create pass-through getters/setters. This makes the RPC mechanism
 * work: the router applies state to the component, the forwarding method
 * syncs it to the service, and getPublicState() returns the service's values.
 */
export function registerServiceState(component: any, serviceInstance: any): void {
    const serviceStateMeta = Reflect.getMetadata('cossack:state', serviceInstance.constructor) || {};
    const stateContainer = component._stateContainer;

    for (const key of Object.keys(serviceStateMeta)) {
        // Register in component's state container so getPublicState() includes it
        stateContainer.setPublic(key, serviceInstance[key]);

        // Create pass-through property: component.key ↔ service.key
        Object.defineProperty(component, key, {
            get: () => serviceInstance[key],
            set: (newValue: any) => {
                serviceInstance[key] = newValue;
                // Keep state container in sync for getPublicState()
                stateContainer.setPublic(key, newValue);

                if (component.isServer) {
                    component._scheduleStateBroadcast(key);
                } else if (!component.isBootstrapping) {
                    component.requestUpdate(key, newValue);
                }
            },
            enumerable: true,
            configurable: true,
        });
    }
}

/**
 * Server-side: create forwarding methods on the component instance
 * that delegate to the corresponding service method, and sync state
 * back to the component's state container after execution.
 */
export function forwardServiceMethods(component: any, serviceInstance: any): void {
    const serverMethods = Reflect.getMetadata('cossack:server-methods', serviceInstance.constructor) || {};
    const clientMethods = Reflect.getMetadata('cossack:client-methods', serviceInstance.constructor) || {};
    const serviceStateMeta = Reflect.getMetadata('cossack:state', serviceInstance.constructor) || {};
    const serviceStateKeys = Object.keys(serviceStateMeta);
    const stateContainer = component._stateContainer;

    for (const methodName of Object.keys(serverMethods)) {
        // Skip @Shared/@Client methods — they run locally
        if (clientMethods[methodName]) continue;
        // Only forward if component doesn't already have this method
        if (component.hasMethod(methodName)) continue;

        const original = serviceInstance[methodName];
        if (typeof original === 'function') {
            component[methodName] = async (...args: any[]) => {
                const result = await original.apply(serviceInstance, args);
                // Sync service state back to component's state container
                // so getPublicState() returns updated values
                for (const key of serviceStateKeys) {
                    stateContainer.setPublic(key, serviceInstance[key]);
                }
                return result;
            };
        }
    }
}

/**
 * Client-side: create HTTP fetch proxies for service @Server-only methods.
 * Uses the same /crpc endpoint as the component's own proxies.
 */
export function proxyServiceMethods(component: any, serviceInstance: any): void {
    const serverMethods = Reflect.getMetadata('cossack:server-methods', serviceInstance.constructor) || {};
    const clientMethods = Reflect.getMetadata('cossack:client-methods', serviceInstance.constructor) || {};
    const serviceStateMeta = Reflect.getMetadata('cossack:state', serviceInstance.constructor) || {};
    const serviceStateKeys = Object.keys(serviceStateMeta);

    // Only proxy methods that are @Server-only (not @Shared, not @Client)
    const serverOnlyMethods = Object.keys(serverMethods).filter(name => !clientMethods[name]);

    if (serverOnlyMethods.length === 0) return;

    // Get componentRouteId the same way proxyHttpMethods does
    const initialState = component.getInitialStateFromWindow();
    const isAppComponent = component.constructor.name === 'App';
    const componentRouteId = isAppComponent
        ? initialState?.appRouteId
        : initialState?.componentRouteId;
    const scopeKey = initialState?.scopeKey;

    if (!componentRouteId) return;

    for (const methodName of serverOnlyMethods) {
        const proxy = async (...args: any[]) => {
            // Build state from the service's @State properties
            const state: Record<string, any> = {};
            for (const key of serviceStateKeys) {
                state[key] = serviceInstance[key];
            }

            component.loading[methodName] = (component.loading[methodName] || 0) + 1;
            component.requestUpdate();

            try {
                const response = await fetch('/crpc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        componentRouteId,
                        target: component._id,
                        action: methodName,
                        state,
                        payload: args,
                        scopeKey,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json() as Record<string, any>;

                if (data._cossack_redirect) {
                    window.location.href = data._cossack_redirect;
                    return;
                }

                let returnValue;
                if ('_cossack_return' in data) {
                    returnValue = data._cossack_return;
                    delete data._cossack_return;
                }

                // Sync updated state back to the service instance
                for (const key in data) {
                    if (RESERVED_STATE_KEYS.has(key)) continue;
                    if (component._isOptimisticLocked(key)) {
                        component._optimisticPendingState[key] = data[key];
                    } else {
                        serviceInstance[key] = data[key];
                    }
                }

                component.requestUpdate();
                return returnValue;
            } catch (error) {
                console.error(`Error calling service action '${methodName}':`, error);
            } finally {
                if (component.loading[methodName] > 0) {
                    component.loading[methodName]--;
                }
                if (!component.loading[methodName] || component.loading[methodName] <= 0) {
                    delete component.loading[methodName];
                }
                component.requestUpdate();
            }
        };

        serviceInstance[methodName] = proxy;
    }
}

/**
 * Find a service instance of the given type among the component's properties.
 * Scans own properties for instances matching the service class.
 */
export function findServiceInstance(component: any, serviceClass: new (...args: any[]) => any): any | null {
    // Check all own properties for an instance of the service class
    for (const key of Object.keys(component)) {
        const value = component[key];
        if (value instanceof serviceClass) {
            return value;
        }
    }
    // Also check prototype chain properties that might have been set via constructor
    // Check TypeScript "parameter properties" (constructor(private x: X))
    // These are stored as own properties on the instance, so Object.keys should find them
    // But also try accessing known metadata
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', component.constructor) || [];
    const paramNames = getConstructorParamNames(component);
    for (let i = 0; i < paramTypes.length; i++) {
        if (paramTypes[i] === serviceClass && paramNames[i]) {
            const val = component[paramNames[i]];
            if (val instanceof serviceClass) {
                return val;
            }
        }
    }
    return null;
}

/**
 * Get constructor parameter names by parsing the constructor source.
 * This is needed to match reflect-metadata param types to actual property names.
 */
export function getConstructorParamNames(component: any): string[] {
    const proto = Object.getPrototypeOf(component);
    const constructorStr = proto.constructor.toString();
    const match = constructorStr.match(/constructor\s*\(([^)]*)\)/);
    if (!match) return [];

    return match[1]
        .split(',')
        .map((param: string) => {
            // Handle TypeScript parameter properties: "private x: Type" or "public x: Type"
            const parts = param.trim().split(/\s+/);
            if (parts.length < 2) return '';
            // Check if it has an access modifier (private/protected/public/readonly)
            const modifiers = ['private', 'protected', 'public', 'readonly'];
            let nameIdx = 0;
            while (nameIdx < parts.length && modifiers.includes(parts[nameIdx])) {
                nameIdx++;
            }
            if (nameIdx >= parts.length) return '';
            const nameWithColon = parts[nameIdx];
            return nameWithColon.split(':')[0].trim();
        })
        .filter(Boolean);
}

