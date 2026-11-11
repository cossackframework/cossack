/**
 * Fields that are the same in every language reach an entry's other translations in the entry's
 * own update; their revision, audit, search and outbox rows follow from this outbox job, queued in
 * that update, so a crash, an abort or an unconfirmed write after the update still writes them.
 */
import { defineAction } from '@cossackframework/core/hooks';
import type { WriteActor } from '../hooks';

export interface SharedFieldsEvent {
    readonly eventId: string;
    readonly topic: 'resource.shared';
    readonly at: number;
    readonly resource: string;
    /** The entry the editor saved, its translation group and the update's operation ID. */
    readonly id: string;
    readonly group: string;
    readonly op: string;
    readonly actor: WriteActor;
}

/** Runs from the outbox; the host handles it, plugins cannot hook it. */
export const sharedFields = defineAction<SharedFieldsEvent>('cms.resource.shared', { version: 1, timeoutMs: 60_000 });

/**
 * The operation ID of one translation's rows from one shared update: the same on every retry, so
 * rows a retry finds already written are not written again. A UUID of version 8 from SHA-256.
 */
export async function sharedOp(op: string, id: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${op}:${id}`)));
    digest[6] = (digest[6]! & 0x0f) | 0x80;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    const hex = [...digest.subarray(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
