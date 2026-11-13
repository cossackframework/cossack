/**
 * A collection or taxonomy moved to another URL path: old links keep answering through
 * automatic redirects. The move is an outbox job, queued in the same write that saves the new
 * path, so the redirects follow even after a crash between the two.
 */
import { defineAction } from '@cossackframework/core/hooks';
import type { Statement } from '@cossackframework/romedb';

export interface PathsMovedEvent {
    readonly eventId: string;
    readonly topic: 'paths.moved';
    readonly at: number;
    /** A collection's entries and archive, or a taxonomy's term archives. */
    readonly kind: 'collection' | 'taxonomy';
    readonly name: string;
    /** The path before (`''` for the site root) and after. */
    readonly from: string;
    readonly to: string;
    /** Who saved it, for the redirects' author. */
    readonly by: string | null;
}

/** Runs from the outbox; the host handles it, plugins cannot hook it. */
export const pathsMoved = defineAction<PathsMovedEvent>('cms.paths.moved', { version: 1, timeoutMs: 60_000 });

/** The outbox row of a move, for the batch that saves the new path. */
export function pathsMovedStatement(move: Omit<PathsMovedEvent, 'eventId' | 'topic'>): Statement {
    const event: PathsMovedEvent = { ...move, eventId: `paths.moved:${move.kind}:${move.name}:${crypto.randomUUID()}`, topic: 'paths.moved' };
    return {
        rql: 'INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($move_id, $move_topic, $move_payload, $move_at, $move_at, 0, 0)',
        params: { $move_id: event.eventId, $move_topic: event.topic, $move_payload: JSON.stringify(event), $move_at: event.at },
    };
}
