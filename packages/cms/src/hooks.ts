/**
 * Named, versioned CMS extension points. Plugins register handlers in their `server.ts`;
 * the host invokes them through `@cossackframework/core/hooks`.
 */
import { defineAction, defineFilter } from '@cossackframework/core/hooks';
import type { RecordShape } from './records';
import type { FormField, FormValues, NotificationRule, SubmissionShape } from './form-builder';

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

// --- Forms ----------------------------------------------------------------------------

/** The form a hook runs for. */
export interface FormRef {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly inputs: readonly FormField[];
}

/** Who submits and from where. */
export interface SubmissionContext {
    readonly form: FormRef;
    readonly actor: WriteActor;
    readonly ip?: string;
    readonly userAgent?: string;
    /** The page the form was on. */
    readonly page?: string;
}

/** Messages by input name; `_form` for one about the whole submission. */
export type FormErrors = { readonly [name: string]: string };

/**
 * Check a submission after the form's own checks, as Gravity Forms' `gform_validation`: return
 * the errors with yours added. The values are those of the shown inputs. No external effects.
 */
export const formValidate = defineFilter<FormErrors, SubmissionContext & { readonly values: FormValues }>('cms.form.validate', { version: 1, timeoutMs: 2_000 });

/** Change the values about to be stored, once they are valid. They are checked again after. */
export const formBeforeSubmit = defineFilter<FormValues, SubmissionContext>('cms.form.before-submit', { version: 1, timeoutMs: 2_000 });

/** Values a form starts with: the defaults, then hidden fields from the page address. */
export const formPrefill = defineFilter<FormValues, { readonly form: FormRef; readonly actor: WriteActor; readonly query: { readonly [name: string]: string } }>('cms.form.prefill', { version: 1, timeoutMs: 1_000 });

/** What the sender sees after submitting: a Markdown message, or a page to go to. */
export type FormConfirmation = { readonly kind: 'message'; readonly message: string } | { readonly kind: 'redirect'; readonly url: string };
export const formConfirmation = defineFilter<FormConfirmation, { readonly form: FormRef; readonly submission: SubmissionShape }>('cms.form.confirmation', { version: 1, timeoutMs: 2_000 });

/** An email about to go out for a notification rule. Return null to not send it. */
export interface FormEmail {
    readonly to: readonly string[];
    readonly subject: string;
    readonly text: string;
    readonly replyTo?: string;
}
export const formNotification = defineFilter<FormEmail | null, { readonly form: FormRef; readonly submission: SubmissionShape; readonly rule: NotificationRule }>('cms.form.notification', { version: 1, timeoutMs: 2_000 });

export interface FormSubmittedEvent {
    /** Outbox ID, stable across repeated deliveries: use it as the idempotency key. */
    readonly eventId: string;
    readonly topic: 'form.submitted';
    readonly form: FormRef;
    readonly submission: SubmissionShape;
    readonly actor: WriteActor;
    readonly at: number;
    /** False when the form keeps no submissions: the event is all there is. */
    readonly stored: boolean;
}

/** After a submission is committed, run from the outbox, as Gravity Forms' `gform_after_submission`. Deliveries can repeat. */
export const formSubmitted = defineAction<FormSubmittedEvent>('cms.form.submitted', { version: 1, timeoutMs: 10_000 });

export const EXTENSION_POINTS = Object.freeze([beforeWrite, afterCommit, formValidate, formBeforeSubmit, formPrefill, formConfirmation, formNotification, formSubmitted]);
