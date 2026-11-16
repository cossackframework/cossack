/**
 * Named, versioned CMS extension points. Plugins register handlers in their `server.ts`;
 * the host invokes them through `@cossackframework/core/hooks`.
 */
import { defineAction, defineFilter } from '@cossackframework/core/hooks';
import type { RecordShape } from './records';
import type { Block } from './blocks';
import type { FormField, FormValues, NotificationRule, SubmissionShape } from './form-builder';
import type { CommentStatus } from './comments';
import type { MenuItem } from './menus';
import type { TermShape } from './taxonomy';

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
    /**
     * The record after the write, as its readers see it; null after delete. A protected or
     * members-only entry comes without its password and content (`lockedView`): read it with a
     * grant of your own when you need them.
     */
    readonly record: RecordShape | null;
    /** The record's `status` before the write, for resources with one; null on create. */
    readonly previousStatus?: string | null;
}

/** After-commit work, run from the outbox. Deliveries can repeat. */
export const afterCommit = defineAction<ResourceEvent>('cms.resource.after-commit', { version: 1, timeoutMs: 10_000 });

/** A purge of the caches in front of the site: the tags and URLs of the pages a change touched. */
export interface CachePurgeEvent {
    /** Outbox ID, stable across repeated deliveries: use it as the idempotency key. */
    readonly eventId: string;
    readonly topic: 'cache.purge';
    readonly at: number;
    /** The site whose pages changed: `main`, or the registry ID. */
    readonly site: string;
    /** What changed: `entry:<collection>`, `settings`, `menus`, `comments`, `manual`, and so on. */
    readonly reason: string;
    /** `Cache-Tag` values to purge; the site's tag alone (`cms:<site>`) means every page of the site. */
    readonly tags: readonly string[];
    /** Absolute URLs to purge, for caches without tags. */
    readonly urls: readonly string[];
}

/**
 * Purge the caches in front of the site, run from the outbox. Handlers are purgers: the
 * Cloudflare one the application adds, and a plugin's for another CDN. Deliveries can repeat.
 */
export const cachePurge = defineAction<CachePurgeEvent>('cms.cache.purge', { version: 1, timeoutMs: 15_000 });

/**
 * A plugin's job: queued by `context.jobs.enqueue`, or by the clock through the manifest's
 * `schedules`, and delivered from the outbox to the plugin's handler of `name`.
 */
export interface PluginJobEvent {
    readonly eventId: string;
    readonly topic: 'plugin.job';
    readonly at: number;
    readonly plugin: string;
    readonly name: string;
    readonly payload: unknown;
    /** The occurrence a schedule queued, or null for a job the plugin queued. */
    readonly scheduledAt: number | null;
    /** The key `enqueue` was given, or null. */
    readonly key: string | null;
}
/** Internal: the host routes each event to its plugin's handler. Not an extension point plugins declare. */
export const pluginJob = defineAction<PluginJobEvent>('cms.plugin.job', { version: 1, timeoutMs: 60_000 });

/** A payment provider's webhook, verified and normalized; delivered from the outbox, so handlers key on `eventId`. */
export interface PaymentEvent {
    readonly eventId: string;
    readonly topic: 'payment.event';
    readonly at: number;
    readonly provider: string;
    /**
     * `checkout.pending`: the checkout is done but its payment is still on its way (a bank transfer);
     * `checkout.completed` follows when it is paid, `payment.failed` when it is not. `refund`'s
     * `amount` is the amount refunded.
     */
    readonly type: 'checkout.completed' | 'checkout.pending' | 'payment.succeeded' | 'payment.failed' | 'subscription.updated' | 'subscription.cancelled' | 'refund';
    /** The provider's own event type, such as `checkout.session.completed`. */
    readonly providerType: string;
    readonly checkoutId: string | null;
    /** Whether this event's payment or subscription was made by a CMS checkout. */
    readonly fromCheckout: boolean;
    /**
     * Whether this event completes a payment: a paid checkout, or a paid invoice (a subscription's
     * renewal, or the first payment of a subscription no CMS checkout made). One payment has one
     * completing event, so a handler counting completed orders counts these; `payment.completed`
     * automations and webhooks fire for them. A payment intent's own events never complete.
     */
    readonly completes: boolean;
    /** The plugin's key for the order, as given to `checkout()`. */
    readonly reference: string | null;
    readonly customerEmail: string | null;
    /** In the currency's minor unit. */
    readonly amount: number | null;
    readonly currency: string | null;
    readonly metadata: { readonly [key: string]: string };
    /** The provider's object as sent, for what the normalized fields leave out. */
    readonly object: unknown;
}
export const paymentEvent = defineAction<PaymentEvent>('cms.payment.event', { version: 1, timeoutMs: 15_000 });

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
    /** The site's address the form was sent from, such as `https://example.com`, for links. */
    readonly origin?: string;
}

/** After a submission is committed, run from the outbox, as Gravity Forms' `gform_after_submission`. Deliveries can repeat. */
export const formSubmitted = defineAction<FormSubmittedEvent>('cms.form.submitted', { version: 1, timeoutMs: 10_000 });

// --- Terms, comments and menus --------------------------------------------------------

/** A term about to be written: what the dashboard or the API sent, after the host's own checks. */
export interface TermDraft {
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly parent: string | null;
    /** Solar icon name, or empty. */
    readonly icon: string;
    /** Values of the field groups attached to the taxonomy, checked before the filter runs. */
    readonly meta: { readonly [field: string]: unknown };
}

export interface TermWriteInput {
    readonly taxonomy: string;
    readonly action: 'create' | 'update';
    /** The term's ID; null on create until the host assigns it. */
    readonly id: string | null;
    readonly previous: TermShape | null;
    readonly actor: WriteActor;
}

/** Adjust or reject a term before it is saved, such as to derive slugs your own way. Throw to reject. */
export const termBeforeSave = defineFilter<TermDraft, TermWriteInput>('cms.term.before-save', { version: 1, timeoutMs: 2_000 });

/** A comment about to be stored, with the status the Discussion settings chose for it. */
export interface CommentDraft {
    readonly content: string;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly authorUrl: string;
    readonly status: CommentStatus;
}

export interface CommentWriteInput {
    readonly collection: string;
    readonly entry: string;
    readonly parent: string | null;
    readonly actor: WriteActor;
    readonly ip?: string;
    readonly userAgent?: string;
}

/**
 * Moderate, check or change a comment before it is stored: return it with `status: 'spam'` to
 * hold it, or throw a validation error to refuse it.
 */
export const commentBeforeSave = defineFilter<CommentDraft, CommentWriteInput>('cms.comment.before-save', { version: 1, timeoutMs: 3_000 });

export interface MenuWriteInput {
    /** The menu's ID; null while it is created. */
    readonly id: string | null;
    readonly name: string;
    readonly actor: WriteActor;
}

/** Adjust or reject a menu's items before they are saved. They are checked again after. */
export const menuBeforeSave = defineFilter<readonly MenuItem[], MenuWriteInput>('cms.menu.before-save', { version: 1, timeoutMs: 2_000 });

// --- Dashboard lists -----------------------------------------------------------------------

/** The quick actions entries lists build in, by `EntryAction.id`; the list runs them itself. */
export const ENTRY_ACTION_IDS = Object.freeze(['edit', 'duplicate', 'trash', 'delete', 'view', 'restore', 'delete-permanently'] as const);
export type BuiltinEntryAction = (typeof ENTRY_ACTION_IDS)[number];

/** An action in an entry's row or the bulk actions menu: a built-in one, a link, or a plugin command to run. */
export interface EntryAction {
    /** A built-in action's name (`ENTRY_ACTION_IDS`), or any name a plugin gives its own so other plugins can find it. */
    readonly id?: string;
    /** What the action says: the quick action's text, or the bulk action's menu entry. */
    readonly label: string;
    /** Where the action goes. */
    readonly href?: string;
    /** The plugin command to run instead, with `{ resource, id }` or `{ resource, ids }` as its input. */
    readonly command?: { readonly plugin: string; readonly name: string };
    /** Shown in the destructive color. */
    readonly danger?: boolean;
    /** A question to confirm before running. */
    readonly confirm?: string;
}

/** A column a plugin adds to an entries list: its values by record ID. */
export interface EntryColumn {
    readonly id: string;
    readonly label: string;
    readonly values: { readonly [recordId: string]: string };
}

export interface EntryListInput {
    readonly resource: string;
    readonly actor: WriteActor;
}

/**
 * The quick actions under an entry in its list, the built-in ones included (named by `id`, in
 * `ENTRY_ACTION_IDS`): add yours, remove or reorder them.
 */
export const entryActions = defineFilter<readonly EntryAction[], EntryListInput & { readonly record: RecordShape }>('cms.dashboard.entry-actions', { version: 1, timeoutMs: 1_000 });
/** Columns of an entries list after the built-in ones, with values for the records shown. */
export const entryColumns = defineFilter<readonly EntryColumn[], EntryListInput & { readonly records: readonly RecordShape[] }>('cms.dashboard.entry-columns', { version: 1, timeoutMs: 2_000 });
/** Actions offered for the selected entries of a list, after the built-in ones. */
export const bulkActions = defineFilter<readonly EntryAction[], EntryListInput>('cms.dashboard.bulk-actions', { version: 1, timeoutMs: 1_000 });

/** A message at the top of every dashboard screen, such as "Connect your payment account". */
export interface DashboardNotice {
    /** Names the notice, so another plugin can find or remove it. */
    readonly id: string;
    readonly tone: 'info' | 'success' | 'warning' | 'error';
    /** Plain text, up to 300 characters. */
    readonly message: string;
    /** A same-site path the notice links to. */
    readonly href?: string;
}

/** What waits for someone, on the dashboard's taskbar: a label, where to go, and a count. */
export interface TaskbarItem {
    readonly id: string;
    readonly label: string;
    /** A same-site path. */
    readonly href: string;
    readonly count?: number;
    readonly tone?: 'info' | 'warning' | 'error';
}

/** Notices above every dashboard screen for the signed-in user. Starts empty. */
export const dashboardNotices = defineFilter<readonly DashboardNotice[], { readonly actor: WriteActor }>('cms.dashboard.notices', { version: 1, timeoutMs: 1_000 });
/** The taskbar's items for the signed-in user, the built-in ones included (comments to moderate, pending review, …). */
export const dashboardTaskbar = defineFilter<readonly TaskbarItem[], { readonly actor: WriteActor }>('cms.dashboard.taskbar', { version: 1, timeoutMs: 1_000 });

/**
 * An entry as machines read it (`Accept: text/markdown`, `?format=md`): the Markdown document
 * with its front matter. Return it with your text added, such as a licence or a source note.
 */
export const siteMarkdown = defineFilter<string, { readonly collection: string; readonly id: string; readonly url: string; readonly record: RecordShape }>('cms.site.markdown', { version: 1, timeoutMs: 1_000 });

// --- The site's entries -----------------------------------------------------------

/** What a `cms.site.entry-view` filter may change of an entry shown on the site. */
export interface EntryViewParts {
    readonly title: string;
    readonly excerpt: string;
    /**
     * Blocks shown before and after the entry's content, in the stored shape (`{ _id, type, data }`),
     * rendered as the entry's own are. `core/html` is refused, so a filter, an isolated plugin's
     * included, never puts markup of its own, or script, on the site.
     */
    readonly before: readonly Block[];
    readonly after: readonly Block[];
}

/**
 * An entry's full view on the site, after it is rendered and before the theme draws it, as
 * WordPress's `the_title` and `the_content`: change its title and excerpt, add blocks before or
 * after its content. Not run for a locked entry (password or members only).
 */
export const siteEntryView = defineFilter<EntryViewParts, { readonly collection: string; readonly id: string; readonly url: string | null; readonly record: RecordShape; readonly signedIn: boolean }>('cms.site.entry-view', { version: 1, timeoutMs: 1_000 });

/** Block types a `cms.site.entry-view` filter may not add: their data is markup. */
export const ENTRY_VIEW_REFUSED_BLOCKS: ReadonlySet<string> = new Set(['core/html']);

// --- Users ------------------------------------------------------------------------

/** A registration before the account is made: what a `cms.user.before-register` filter may change. */
export interface RegistrationDraft {
    readonly email: string;
    readonly name: string;
    /** Role IDs the account gets; roles the site does not have are dropped. */
    readonly roles: readonly string[];
    /** The account waits for an administrator's approval (Settings → General, or a filter's choice). */
    readonly approval: boolean;
    /** Set to refuse the registration: the message the visitor sees. */
    readonly refused: string | null;
}

/**
 * Before a visitor's account is made, as WordPress's `registration_errors` and `user_register`
 * meet: refuse it (an email domain allowlist), choose its roles, or hold it for approval.
 */
export const userBeforeRegister = defineFilter<RegistrationDraft, { readonly origin: string }>('cms.user.before-register', { version: 1, timeoutMs: 2_000 });

export interface UserRef {
    readonly id: string;
    readonly email: string;
    readonly name: string;
}

export interface UserRegisteredEvent {
    /** Outbox ID, stable across repeated deliveries: use it as the idempotency key. */
    readonly eventId: string;
    readonly topic: 'user.registered';
    readonly at: number;
    readonly user: UserRef;
    /** What the account waits for: nothing (`active`), its email link (`verification`), or an administrator (`approval`). */
    readonly state: 'active' | 'verification' | 'approval';
}

/** After a visitor registered, run from the outbox: a welcome email, a CRM contact. Deliveries can repeat. */
export const userRegistered = defineAction<UserRegisteredEvent>('cms.user.registered', { version: 1, timeoutMs: 10_000 });

export interface UserSignedInEvent {
    /** Outbox ID, stable across repeated deliveries: use it as the idempotency key. */
    readonly eventId: string;
    readonly topic: 'user.signed-in';
    readonly at: number;
    readonly user: UserRef;
}

/**
 * After a session started for a user, run from the outbox: by any sign-in method, or the
 * automatic sign-in after registering or confirming the email. Deliveries can repeat.
 */
export const userSignedIn = defineAction<UserSignedInEvent>('cms.user.signed-in', { version: 1, timeoutMs: 10_000 });

/** A `cms.user.before-register` result the host can use: the original email, existing roles, bounded text. */
export function registrationDraftOf(value: unknown, original: RegistrationDraft, roles: ReadonlySet<string>): RegistrationDraft {
    const draft = value && typeof value === 'object' ? value as Partial<RegistrationDraft> : {};
    const name = typeof draft.name === 'string' && draft.name.trim() ? draft.name.trim().slice(0, 191) : original.name;
    const chosen = Array.isArray(draft.roles) ? draft.roles.filter((role): role is string => typeof role === 'string' && roles.has(role)).slice(0, 10) : [...original.roles];
    const refused = typeof draft.refused === 'string' && draft.refused.trim() ? draft.refused.trim().slice(0, 300) : null;
    return { email: original.email, name, roles: [...new Set(chosen)], approval: typeof draft.approval === 'boolean' ? draft.approval : original.approval, refused };
}

// --- Mail -------------------------------------------------------------------------

/** What an email the CMS sends is for. `other` is mail application code sends without saying. */
export const MAIL_KINDS = Object.freeze(['verification', 'reset', 'magic-link', 'invitation', 'comment', 'note', 'automation', 'form', 'plugin', 'other'] as const);
export type MailKind = (typeof MAIL_KINDS)[number];

/** An email about to go out: its plain text, and the HTML the site's layout (Settings → Email) made from it. */
export interface MailMessage {
    readonly to: string;
    /** The site's sender (`MAIL_FROM`); filters cannot change it. */
    readonly from: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
    readonly replyTo?: string;
}

export interface MailSendInput {
    readonly kind: MailKind;
    /** The plugin that sent it through `context.mail` (`kind: 'plugin'`); null for the CMS's own mail. */
    readonly plugin: string | null;
    /** The site sending it: `main`, or the registry ID. */
    readonly site: string;
}

/**
 * Change or stop an email just before it is sent, after the layout: return it with another
 * subject, text or HTML, or null to not send it. Sign-in, reset and invitation mail (and
 * `other`) keep their recipient and reply address whatever a filter returns. A failing or slow
 * filter does not stop the mail: it goes out as the layout made it.
 */
export const mailBeforeSend = defineFilter<MailMessage | null, MailSendInput>('cms.mail.before-send', { version: 1, timeoutMs: 2_000 });

/** The largest subject, text and HTML a `cms.mail.before-send` filter may return, in characters. */
export const MAIL_LIMITS = Object.freeze({ subject: 300, text: 100_000, html: 300_000 });

/** Kinds whose `to` and `replyTo` a filter may change: none of them carries a sign-in link. */
const OPEN_RECIPIENTS: ReadonlySet<MailKind> = new Set(['comment', 'note', 'automation', 'form', 'plugin']);
const MAIL_ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Whether a filter may send this kind of mail elsewhere: never for verification, reset, magic-link, invitation and other mail. */
export function mailRecipientsLocked(kind: MailKind): boolean {
    return !OPEN_RECIPIENTS.has(kind);
}

/**
 * A `cms.mail.before-send` result the host can send: null when a filter cancelled the mail;
 * otherwise the original sender, the original recipient and reply address for locked kinds, one
 * valid address each for the others, a one-line subject, and a text and HTML within
 * `MAIL_LIMITS` (a field that is missing, empty or too large keeps the original).
 */
export function mailMessageOf(value: unknown, original: MailMessage, kind: MailKind): MailMessage | null {
    if (value === null) return null;
    if (!value || typeof value !== 'object') return original;
    const next = value as { readonly [key in keyof MailMessage]?: unknown };
    const subject = typeof next.subject === 'string' && next.subject.trim() ? next.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, MAIL_LIMITS.subject) : original.subject;
    const text = typeof next.text === 'string' && next.text.trim() && next.text.length <= MAIL_LIMITS.text ? next.text : original.text;
    const html = typeof next.html === 'string' && next.html.trim() && next.html.length <= MAIL_LIMITS.html ? next.html : original.html;
    const address = (candidate: unknown): string | null => typeof candidate === 'string' && candidate.trim().length <= 320 && MAIL_ADDRESS.test(candidate.trim()) ? candidate.trim() : null;
    if (mailRecipientsLocked(kind)) return { to: original.to, from: original.from, subject, text, html, ...(original.replyTo ? { replyTo: original.replyTo } : {}) };
    const to = address(next.to) ?? original.to;
    const replyTo = next.replyTo === undefined || next.replyTo === '' ? undefined : address(next.replyTo) ?? original.replyTo;
    return { to, from: original.from, subject, text, html, ...(replyTo ? { replyTo } : {}) };
}

export const EXTENSION_POINTS = Object.freeze([beforeWrite, afterCommit, cachePurge, paymentEvent, formValidate, formBeforeSubmit, formPrefill, formConfirmation, formNotification, formSubmitted,
    termBeforeSave, commentBeforeSave, menuBeforeSave, entryActions, entryColumns, bulkActions, dashboardNotices, dashboardTaskbar, siteMarkdown, siteEntryView,
    userBeforeRegister, userRegistered, userSignedIn,
    mailBeforeSend]);

const TONES = new Set(['info', 'success', 'warning', 'error']);
const sameSitePath = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length <= 500;

/** The notices a filter returned that the dashboard can show: well-formed, at most ten. Anything else is dropped. */
export function dashboardNoticesOf(value: unknown): DashboardNotice[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is DashboardNotice => !!entry && typeof entry === 'object' && typeof entry.id === 'string' && TONES.has(entry.tone)
        && typeof entry.message === 'string' && entry.message.trim().length > 0 && (entry.href === undefined || sameSitePath(entry.href)))
        .slice(0, 10).map(entry => ({ id: entry.id.slice(0, 80), tone: entry.tone, message: entry.message.trim().slice(0, 300), ...(entry.href ? { href: entry.href } : {}) }));
}

/** The taskbar items a filter returned that the taskbar can show: well-formed, at most twenty. */
export function taskbarItemsOf(value: unknown): TaskbarItem[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is TaskbarItem => !!entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.label === 'string' && entry.label.trim().length > 0
        && sameSitePath(entry.href) && (entry.count === undefined || (Number.isSafeInteger(entry.count) && entry.count >= 0)) && (entry.tone === undefined || (TONES.has(entry.tone) && entry.tone !== 'success')))
        .slice(0, 20).map(entry => ({ id: entry.id.slice(0, 80), label: entry.label.trim().slice(0, 60), href: entry.href, ...(entry.count !== undefined ? { count: entry.count } : {}), ...(entry.tone ? { tone: entry.tone } : {}) }));
}
