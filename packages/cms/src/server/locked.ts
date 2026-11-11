/**
 * Locked entries (specs/cms-invariants.md, rule 1): an entry with a password (protected) or
 * members-only. Those who may update it read it whole; everyone else gets the reader's view:
 * its core fields, taxonomies and lock flags, without its password or its content. This module
 * is the one place that says what is locked and what the reader's view holds.
 */
import { CORE_FIELDS } from '../collections';
import type { FieldDeclaration } from '../fields';
import type { RecordShape } from '../records';

/** Whether an entry is protected (it has a password) or members-only. */
export function isLockedRecord(record: { readonly [field: string]: unknown }): boolean {
    return (typeof record.password === 'string' && record.password.length > 0) || record.membersOnly === true;
}

/** Fields that stay in the reader's view of a locked entry: the lock itself, so readers know why. */
const LOCK_FIELDS: readonly string[] = ['membersOnly'];

/**
 * The fields a locked entry's readers do not get: every declared field but the core fields
 * (less `summary`, which is written from the content), taxonomies and the lock flags. The
 * password is always among them.
 */
export function withheldFieldNames(fields: { readonly [name: string]: FieldDeclaration }): Set<string> {
    const kept = new Set<string>([...CORE_FIELDS.filter(name => name !== 'summary'), ...LOCK_FIELDS]);
    return new Set(Object.entries(fields)
        .filter(([name, field]) => name === 'password' || (!kept.has(name) && !(field.kind === 'string' && field.taxonomy)))
        .map(([name]) => name));
}

/**
 * The reader's view of a record: without its password always, and, when it is locked, without
 * the withheld fields (`withheldFieldNames`). Undeclared keys (id, revision, timestamps, owner)
 * stay. A record that is not locked comes back whole, less an empty password.
 */
export function lockedView<T extends RecordShape>(record: T, fields: { readonly [name: string]: FieldDeclaration }): T {
    if (!isLockedRecord(record)) {
        if (!('password' in record)) return record;
        const { password: _password, ...rest } = record;
        return rest as unknown as T;
    }
    const withheld = withheldFieldNames(fields);
    withheld.add('password');
    return Object.fromEntries(Object.entries(record).filter(([name]) => !withheld.has(name))) as unknown as T;
}
