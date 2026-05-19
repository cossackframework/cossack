// src/shared/service-bootstrap.ts
import 'reflect-metadata';
import type { Cossack } from './cossack';

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
