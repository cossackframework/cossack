import './metadata';
import { ActionValidationError } from './errors';
import { isInputSchema, type InputParseOptions } from './input-schema';
import { RpcError } from './rpc-stream';

/**
 * Enforce a `@Server({ input })` contract on an inbound RPC payload (RT-02).
 * Schemas parse one argument. Rule maps are not action contracts in 0.9.
 * Expected failures carry nested errors;
 * callback exceptions remain internal. Transport cancellation skips mutation.
 */
export async function enforceActionInput(
    constructor: unknown,
    action: string,
    payload: unknown[],
    options: InputParseOptions = {},
): Promise<unknown[]> {
    if (options.signal?.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
    if (!Array.isArray(payload)) {
        throw new ActionValidationError({ _: 'RPC payload must be an array of arguments.' });
    }
    const registration = findServerMethodRegistration(constructor, action);
    if (!registration || !Object.hasOwn(registration, 'input')) return payload;
    if (isInputSchema(registration.input)) {
        if (payload.length > 1) throw new ActionValidationError({ _: 'This action accepts one input argument.' });
        try { return [await registration.input.parse(payload[0], options)]; }
        catch (error) {
            if (options.signal?.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
            throw error;
        }
    }
    throw new Error('[Cossack] Invalid server action input contract. Use an input schema; rule maps must migrate to input.object().');
}

/** @internal Shared by the input and authorization gates. */
export function findServerMethodRegistration(constructor: unknown, action: string): Record<string, unknown> | undefined {
    let proto: object | null = typeof constructor === 'function' ? constructor : null;
    while (proto !== null && proto !== Function.prototype) {
        const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', proto) as
            | Record<string, Record<string, unknown>>
            | undefined;
        const registration = serverMethods && Object.hasOwn(serverMethods, action) ? serverMethods[action] : undefined;
        if (registration) return registration;
        proto = Object.getPrototypeOf(proto);
    }
    return undefined;
}
