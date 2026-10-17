/**
 * Named, versioned CMS extension points. Plugins register handlers in their `server.ts`;
 * the host invokes them through `@cossackframework/core/hooks`.
 */
import { defineAction, defineFilter } from '@cossackframework/core/hooks';
import type { RecordShape } from './records';

export interface WriteActor {
    readonly kind: 'user' | 'system' | 'anonymous';
    readonly id: string;
}

export interface BeforeWriteInput {
    readonly resource: string;
    readonly action: 'create' | 'update';
    /** Record ID; null on create until the host assigns it. */
    readonly id: string | null;
    readonly previous: RecordShape | null;
    readonly actor: WriteActor;
}

/** Field values about to be written. */
export type Draft = { readonly [field: string]: unknown };

/**
 * Validate or adjust a draft before the batch is prepared. Runs under a deadline;
 * no external effects. Throw to reject the write; the host reports a validation error.
 */
export const beforeWrite = defineFilter<Draft, BeforeWriteInput>('cms.resource.before-write', { version: 1, timeoutMs: 2_000 });

export interface ResourceEvent {
    /** Outbox ID, stable across repeated deliveries: use it as the idempotency key. */
    readonly eventId: string;
    readonly topic: 'resource.created' | 'resource.updated' | 'resource.deleted';
    readonly resource: string;
    readonly id: string;
    readonly revision: number;
    readonly actor: WriteActor;
    readonly at: number;
    /** Public record after the write; null after delete. */
    readonly record: RecordShape | null;
    /** The record's `status` before the write, for resources with one; null on create. */
    readonly previousStatus?: string | null;
}

/** After-commit work, run from the outbox. Deliveries can repeat. */
export const afterCommit = defineAction<ResourceEvent>('cms.resource.after-commit', { version: 1, timeoutMs: 10_000 });

export const EXTENSION_POINTS = Object.freeze([beforeWrite, afterCommit]);
