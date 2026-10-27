/**
 * Forms on the host. Each form's submissions resource is kept in step with the form: its own
 * table, created and extended by the migrator when the form's inputs change. Submitting runs
 * the form's rules, the validation filters and one atomic write of the submission, its
 * receipt and its outbox event; notifications, webhooks and plugin actions run from the
 * outbox. Handling submissions needs `cms:submissions`.
 */
import type { Statement, Value } from '@cossackframework/romedb';
import type { FilterPoint } from '@cossackframework/core/hooks';
import { CmsError } from '../errors';
import { SLUG_PATTERN } from '../fields';
import type { Block } from '../blocks';
import {
    conditionShows, displayValue, emailAddresses, escapeMarkdown, formInputs, formSettings, notificationRules, renderMergeTags, submissionOf, submissionResource,
    SUBMISSION_STATUSES, validateSubmission, type FormSettings, type FormValues, type MergeContext, type NotificationRule, type SubmissionMeta, type SubmissionShape,
    type SubmissionStatus, type SubmittedValues,
} from '../form-builder';
import {
    formBeforeSubmit, formConfirmation, formNotification, formPrefill, formValidate, type FormConfirmation, type FormEmail, type FormErrors, type FormRef, type FormSubmittedEvent, type WriteActor,
} from '../hooks';
import { hasPermission, PERMISSIONS, systemPrincipal, type Principal } from '../permissions';
import type { RecordShape } from '../records';
import { declarationHash, resolveResource, type Resource } from '../resource';
import { migrate } from './schema';
import { sha256Hex } from './tokens';
import { bound, type ResourceRepository } from './repository';
import type { CmsHost } from './host';

/** Sends email, such as Cloudflare's `EMAIL` binding or an SMTP client. */
export interface CmsMail {
    send(message: { readonly to: string; readonly from: string; readonly subject: string; readonly text: string; readonly replyTo?: string }): Promise<unknown>;
}

/** A form with what the host needs to take its submissions. */
export interface LoadedForm {
    readonly record: RecordShape;
    readonly ref: FormRef;
    readonly blocks: readonly Block[];
    readonly settings: FormSettings;
    /** The rules that are on. */
    readonly rules: readonly NotificationRule[];
    readonly enabled: boolean;
    /** Published forms are on the site and take submissions; drafts are only in the dashboard. */
    readonly published: boolean;
    readonly resource: Resource;
}

export interface SubmitContext {
    readonly principal: Principal;
    readonly ip?: string;
    readonly userAgent?: string;
    readonly referrer?: string;
    /** The page the form was on. */
    readonly page?: string;
    readonly locale?: string;
    /** The site's address, such as `https://example.com`, for links in notifications. */
    readonly origin?: string;
    /** The form's hidden trap field, which only bots fill in. */
    readonly trap?: string;
    /** When the page rendered the form, in Unix milliseconds of the server; quicker submissions are spam. */
    readonly startedAt?: number;
    /** Checks the bot challenge, when the form asks for one; resolves false to reject. */
    readonly botCheck?: () => Promise<boolean>;
    readonly signal?: AbortSignal;
}

export interface SubmitResult {
    readonly form: LoadedForm;
    readonly submission: SubmissionShape;
    readonly confirmation: FormConfirmation;
}

export interface SubmissionList {
    readonly items: readonly SubmissionShape[];
    readonly next?: string;
}

const SYSTEM = systemPrincipal('forms');
const SLUG = new RegExp(`^${SLUG_PATTERN}$`);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** One submission per address and form in this time. */
const THROTTLE_MS = 5_000;
/** Filled in faster than people can: spam. */
const MIN_FILL_MS = 2_000;
const DAY = 24 * 60 * 60 * 1000;
const WRITE = { kind: 'cms.forms', retryConflicts: 5 } as const;
/** What a handled submission may be set to. */
const STATUSES = new Set<string>(SUBMISSION_STATUSES);

function writeActor(principal: Principal): WriteActor {
    return principal.kind === 'user' ? { kind: 'user', id: principal.id } : principal.kind === 'system' ? { kind: 'system', id: principal.reason } : { kind: 'anonymous', id: 'anonymous' };
}

export class CmsForms {
    readonly #host: CmsHost;
    readonly #mail: CmsMail | undefined;
    readonly #from: string;
    /** Submission resources by ID, as last loaded. */
    readonly #resources = new Map<string, Resource>();
    /** The declaration hash each resource's table is known to have. */
    readonly #synced = new Map<string, string>();
    /** Forms loaded in this isolate, by ID, with the revision they were loaded at. */
    readonly #loaded = new Map<string, { key: string; form: LoadedForm }>();
    #warned = false;

    constructor(host: CmsHost, options: { mail?: CmsMail; mailFrom?: string } = {}) {
        this.#host = host;
        this.#mail = options.mail;
        this.#from = options.mailFrom ?? 'no-reply@example.com';
    }

    /** A submission resource this isolate has loaded, for `CmsHost.resourceById`. */
    resourceById(id: string): Resource | undefined {
        return this.#resources.get(id);
    }

    /** A form by slug or ID, with its submissions table in step. Null when there is none. */
    async get(key: string, options: { signal?: AbortSignal } = {}): Promise<LoadedForm | null> {
        const forms = this.#host.resource('cms/forms');
        const context = { principal: SYSTEM, ...(options.signal ? { signal: options.signal } : {}) };
        let record = SLUG.test(key) ? (await forms.list({ where: { slug: key }, limit: 1 }, context)).records[0] ?? null : null;
        if (!record && ID.test(key)) record = await forms.get(key, context);
        return record ? this.load(record) : null;
    }

    /** Forms by title, at most 200, with their submission tables in step. */
    async all(): Promise<LoadedForm[]> {
        const page = await this.#host.resource('cms/forms').list({ order: { field: 'title', direction: 'asc' }, limit: 100 }, { principal: SYSTEM });
        const second = page.more ? await this.#host.resource('cms/forms').list({ order: { field: 'title', direction: 'asc' }, limit: 100, offset: 100 }, { principal: SYSTEM }) : { records: [] };
        return Promise.all([...page.records, ...second.records].filter(record => record.status !== 'trash').map(record => this.load(record)));
    }

    /** A form from its record. Brings its submissions table up to date when the inputs changed. */
    async load(record: RecordShape): Promise<LoadedForm> {
        // A form at the same revision, with the same block types, has the same table.
        const key = `${record.rev}:${record.updatedAt}:${this.#host.blockTypes.size}`;
        const cached = this.#loaded.get(record.id);
        if (cached?.key === key && this.#synced.has(cached.form.resource.id)) {
            this.#resources.set(cached.form.resource.id, cached.form.resource);
            return cached.form;
        }
        const form = await this.#build(record);
        this.#loaded.set(record.id, { key, form });
        return form;
    }

    async #build(record: RecordShape): Promise<LoadedForm> {
        const blocks = Array.isArray(record.body) ? record.body as Block[] : [];
        const inputs = formInputs(blocks, this.#host.blockTypes);
        const settings = formSettings(record.settings);
        const title = typeof record.title === 'string' ? record.title : '';
        const resource = resolveResource(submissionResource({ id: record.id, title }, inputs, { indexed: settings.oncePerEmail ? [settings.oncePerEmail] : [] }), 'cms');
        await this.#sync(resource);
        return Object.freeze({
            record, blocks, settings, resource, enabled: record.enabled !== false, published: record.status === 'published',
            ref: Object.freeze({ id: record.id, slug: typeof record.slug === 'string' ? record.slug : record.id, title, inputs }),
            rules: Object.freeze(notificationRules(record.notifications).filter(rule => rule.enabled !== false)),
        });
    }

    async #sync(resource: Resource): Promise<void> {
        this.#resources.set(resource.id, resource);
        const hash = await declarationHash(resource);
        if (this.#synced.get(resource.id) === hash) return;
        const state = await this.#host.db.read([{ rql: 'SELECT declaration_hash FROM cms_schema_state WHERE resource = $id', params: { $id: resource.id } }]);
        if (state.results[0]!.rows[0]?.[0] !== hash) {
            const report = await migrate(this.#host.db, [resource], { now: () => this.#host.now(), only: [resource.id] });
            const blocked = report.blocked.filter(problem => problem.resource === resource.id);
            if (report.failed || blocked.length) throw new CmsError('CMS_UNAVAILABLE', `The form's submissions table could not be updated: ${report.failed?.message ?? blocked.map(problem => problem.message).join(' ')}`);
        }
        this.#synced.set(resource.id, hash);
        // Activation caches the recorded hashes; read them again.
        this.#host.refreshActivation();
    }

    /** Drop a deleted form's submissions table. Runs from the outbox after the form is deleted. */
    async dropTable(formId: string): Promise<void> {
        const id = `cms/form_${formId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const storage = `r__cms__${id.slice(4)}`;
        const info = await this.#host.db.read([{ rql: 'INFO FOR DB' }]);
        const exists = ((info.results[0]!.rows[0]![0] as { tables?: { name: string }[] }).tables ?? []).some(table => table.name === storage);
        await this.#host.db.write([
            ...(exists ? [{ rql: `DROP TABLE ${storage}` }] : []),
            { rql: 'DELETE FROM cms_schema_state WHERE resource = $id', params: { $id: id } },
        ], { kind: 'cms.migration' });
        this.#resources.delete(id);
        this.#synced.delete(id);
        this.#loaded.delete(formId);
        this.#host.refreshActivation();
    }

    // --- Submitting ---------------------------------------------------------------------

    /** Why the form takes no submissions now, or null when it is open. Counts kept submissions against the limit. */
    async closed(form: LoadedForm): Promise<string | null> {
        const { settings } = form;
        const now = this.#host.now();
        if (!form.enabled || (settings.opensAt !== null && now < settings.opensAt) || (settings.closesAt !== null && now >= settings.closesAt)) return settings.closedMessage;
        if (settings.limit !== null && settings.store && await this.#kept(form) >= settings.limit) return settings.closedMessage;
        return null;
    }

    /** Values the form starts with: input defaults, hidden inputs from the page's query, then `cms.form.prefill`. */
    async prefill(form: LoadedForm, query: { readonly [name: string]: string }, principal: Principal): Promise<FormValues> {
        const values: { [name: string]: FormValues[string] } = {};
        for (const input of form.ref.inputs) {
            const fallback = input.data.defaultValue;
            if (input.type === 'form/hidden' && typeof query[input.name] === 'string') values[input.name] = query[input.name]!.slice(0, 500);
            else if (fallback !== undefined && fallback !== null && fallback !== '') values[input.name] = fallback as FormValues[string];
        }
        try {
            return await this.#host.hooks.applyFilters(formPrefill, Object.freeze(values), { form: form.ref, actor: writeActor(principal), query: Object.freeze({ ...query }) });
        } catch { return Object.freeze(values); }
    }

    /**
     * Take a submission: the form must be open, the sender allowed and not too quick, the
     * values valid by the form and by `cms.form.validate`. Spam (the trap filled in, or sent
     * faster than people can) is kept as spam when the form keeps submissions, runs no hooks
     * and answers like a real submission, so bots learn nothing.
     */
    async submit(key: string, raw: SubmittedValues, context: SubmitContext): Promise<SubmitResult> {
        const form = await this.get(key, context.signal ? { signal: context.signal } : {});
        if (!form?.published) throw new CmsError('CMS_NOT_FOUND', 'This form does not exist.');
        const { settings } = form;
        const types = this.#host.blockTypes;
        const closed = await this.closed(form);
        if (closed !== null) throw new CmsError('CMS_FORBIDDEN', closed);
        const user = context.principal.kind === 'user' ? context.principal.id : null;
        if ((settings.requireSignIn || settings.oncePerUser) && !user) throw new CmsError('CMS_UNAUTHENTICATED', 'Sign in to send this form.');
        if (settings.turnstile && context.botCheck && !(await context.botCheck())) throw new CmsError('CMS_FORBIDDEN', 'The check against bots failed. Try again.');
        const now = this.#host.now();
        const ipHash = context.ip ? await sha256Hex(`cms-form:${form.ref.id}:${context.ip}`) : null;
        if (ipHash) {
            const last = await this.#host.db.read([{ rql: 'SELECT max(at) FROM cms_form_sends WHERE form_id = $form AND ip_hash = $ip AND at > $since', params: { $form: form.ref.id, $ip: ipHash, $since: now - THROTTLE_MS } }]);
            if (last.results[0]!.rows[0]?.[0] !== null && last.results[0]!.rows[0]?.[0] !== undefined) throw new CmsError('CMS_LIMIT', 'You sent this form a moment ago. Wait a few seconds and try again.');
        }
        const spam = Boolean(context.trap) || (typeof context.startedAt === 'number' && Number.isFinite(context.startedAt) && now - context.startedAt < MIN_FILL_MS);
        const actor = writeActor(context.principal);
        const hookContext = { form: form.ref, actor, ...(context.ip ? { ip: context.ip } : {}), ...(context.userAgent ? { userAgent: context.userAgent } : {}), ...(context.page ? { page: context.page } : {}) };
        const check = validateSubmission(form.blocks, types, raw);
        let values = check.values;
        if (!spam) {
            const errors = await this.#filter(formValidate, check.errors, { ...hookContext, values });
            if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', 'Check the fields marked below.', { fields: { ...errors } });
            const changed = await this.#filter(formBeforeSubmit, values, hookContext);
            if (changed !== values) {
                const again = validateSubmission(form.blocks, types, changed);
                const problem = Object.entries(again.errors)[0];
                if (problem) throw new CmsError('CMS_VALIDATION', `A plugin set ${problem[0]} to a value the form does not take: ${problem[1]}`);
                values = again.values;
            }
            if (settings.store && settings.oncePerUser && user && await this.#exists(form, '"_owner" = $value', user)) throw new CmsError('CMS_CONFLICT', 'You already sent this form.');
            const email = settings.oncePerEmail ? values[settings.oncePerEmail] : undefined;
            if (settings.store && typeof email === 'string' && await this.#exists(form, `"${settings.oncePerEmail}" = $value`, email)) {
                throw new CmsError('CMS_CONFLICT', 'This address already sent this form.', { fields: { [settings.oncePerEmail]: 'This address already sent this form.' } });
            }
        }
        const id = crypto.randomUUID();
        const op = crypto.randomUUID();
        const meta: { -readonly [K in keyof SubmissionMeta]: string } = {};
        if (settings.recordIp && context.ip) meta.ip = context.ip.slice(0, 64);
        if (context.userAgent) meta.userAgent = context.userAgent.slice(0, 300);
        if (context.referrer) meta.referrer = context.referrer.slice(0, 2048);
        if (context.page) meta.page = context.page.slice(0, 2048);
        if (context.locale) meta.locale = context.locale.slice(0, 16);
        const status: SubmissionStatus = spam ? 'spam' : 'new';
        const submission: SubmissionShape = Object.freeze({ id, form: form.ref.id, status, values, note: '', meta: Object.freeze(meta), user, createdAt: now, updatedAt: now });
        const event: FormSubmittedEvent = { eventId: op, topic: 'form.submitted', form: form.ref, submission, actor, at: now, stored: settings.store, ...(context.origin ? { origin: context.origin } : {}) };
        const sendParams = { $op: op, $form: form.ref.id, $ip: ipHash, $at: now };
        const eventParams = { $op: op, $payload: JSON.stringify(event), $at: now };
        if (settings.store) {
            await this.#host.resource(form.resource.id).insert({ ...values, status, ...(Object.keys(meta).length ? { meta } : {}) }, {
                principal: SYSTEM, id, op, owner: user, kind: 'cms.forms.submit', ...(context.signal ? { signal: context.signal } : {}),
                attach: guard => [
                    bound(`INSERT INTO cms_form_sends (id, form_id, ip_hash, at) SELECT $op, $form, $ip, $at WHERE ${guard.rql}`, { ...guard.params, ...sendParams }),
                    ...(spam ? [] : [bound(`INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) SELECT $op, 'form.submitted', $payload, $at, $at, 0, 0 WHERE ${guard.rql}`, { ...guard.params, ...eventParams })]),
                ],
            });
        } else {
            const statements: Statement[] = [{ rql: 'INSERT INTO cms_form_sends (id, form_id, ip_hash, at) VALUES ($op, $form, $ip, $at)', params: sendParams }];
            if (!spam) statements.push({ rql: "INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($op, 'form.submitted', $payload, $at, $at, 0, 0)", params: eventParams });
            await this.#host.db.write(statements, { requestId: op, kind: 'cms.forms.submit', ...(context.signal ? { signal: context.signal } : {}) });
            this.#host.outboxWritten();
        }
        const merge = await this.#mergeContext(form.ref, submission, context.origin ?? '');
        let confirmation: FormConfirmation = settings.confirmation === 'redirect' && settings.redirectUrl
            ? { kind: 'redirect', url: settings.redirectUrl }
            : { kind: 'message', message: renderMergeTags(settings.message, merge, { escape: escapeMarkdown }) };
        if (!spam) {
            try { confirmation = await this.#host.hooks.applyFilters(formConfirmation, confirmation, { form: form.ref, submission }); }
            catch (error) { console.error('[cms] a cms.form.confirmation handler failed; the form\'s own confirmation is shown', error); }
        }
        return { form, submission, confirmation };
    }

    /** Run a filter, reporting a failing or slow handler as a validation error. */
    async #filter<V, I>(point: FilterPoint<V, I>, value: V, input: I): Promise<V> {
        const apply = this.#host.hooks.applyFilters.bind(this.#host.hooks) as unknown as (point: FilterPoint<V, I>, value: V, input: I) => Promise<V>;
        try {
            return await apply(point, value, input);
        } catch (error) {
            const cause = (error as { cause?: unknown }).cause;
            throw new CmsError('CMS_VALIDATION', cause instanceof Error ? cause.message : 'A plugin rejected the submission.', { cause: error });
        }
    }

    async #kept(form: LoadedForm): Promise<number> {
        const result = await this.#host.db.read([{ rql: `SELECT count(*) FROM ${form.resource.storage} WHERE status IN ('new', 'read')` }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    async #exists(form: LoadedForm, condition: string, value: Value): Promise<boolean> {
        const result = await this.#host.db.read([{ rql: `SELECT 1 FROM ${form.resource.storage} WHERE ${condition} AND status != 'trash' LIMIT 1`, params: { $value: value } }]);
        return result.results[0]!.rows.length > 0;
    }

    async #mergeContext(form: FormRef, submission: SubmissionShape, origin: string): Promise<MergeContext> {
        const settings = await this.#host.settings.all();
        const user = submission.user ? await this.#host.users.get(submission.user) : null;
        return {
            form: { id: form.id, title: form.title }, inputs: form.inputs, values: submission.values,
            submission: { id: submission.id, url: `${origin}/dashboard/forms/${form.id}/submissions/${submission.id}`, date: new Date(submission.createdAt).toISOString() },
            user: user ? { email: user.email, name: user.name } : null,
            site: { title: String(settings['general.siteTitle'] ?? ''), url: origin, adminEmail: String(settings['general.adminEmail'] ?? '') },
        };
    }

    // --- After a submission ---------------------------------------------------------------

    /**
     * Send the form's notification emails for a submission. Runs from the outbox; an email
     * already sent for the event, rule and address is not sent again when delivery repeats.
     */
    async notify(event: FormSubmittedEvent): Promise<void> {
        const form = await this.get(event.form.id).catch(() => null);
        if (!form || !form.rules.length) return;
        if (!this.#mail) {
            if (!this.#warned) console.warn('[cms] form notifications are skipped: createCMS has no mail option.');
            this.#warned = true;
            return;
        }
        const context = await this.#mergeContext(event.form, event.submission, event.origin ?? '');
        for (const rule of form.rules) {
            if (!conditionShows(rule.when, event.submission.values)) continue;
            const replyTo = rule.replyTo ? emailAddresses(renderMergeTags(rule.replyTo, context))[0] : undefined;
            const drafted: FormEmail = {
                to: emailAddresses(renderMergeTags(rule.to, context)),
                subject: renderMergeTags(rule.subject, context).replace(/[\r\n]+/g, ' ').trim().slice(0, 300),
                text: renderMergeTags(rule.body, context),
                ...(replyTo ? { replyTo } : {}),
            };
            const email = await this.#host.hooks.applyFilters(formNotification, drafted, { form: event.form, submission: event.submission, rule });
            if (!email) continue;
            for (const to of emailAddresses(email.to.join(','))) {
                const key = `${event.eventId}:${rule.id}:${to.toLowerCase()}`;
                const sent = await this.#host.db.read([{ rql: 'SELECT 1 FROM cms_form_mail WHERE id = $id', params: { $id: key } }]);
                if (sent.results[0]!.rows.length) continue;
                const reply = email.replyTo ? emailAddresses(email.replyTo)[0] : undefined;
                await this.#mail.send({ to, from: this.#from, subject: email.subject.replace(/[\r\n]+/g, ' ').slice(0, 300), text: email.text, ...(reply ? { replyTo: reply } : {}) });
                await this.#host.db.write([{ rql: 'INSERT INTO cms_form_mail (id, sent_at) VALUES ($id, $now) ON CONFLICT (id) DO NOTHING', params: { $id: key, $now: this.#host.now() } }], WRITE);
            }
        }
    }

    // --- Handling submissions ---------------------------------------------------------------

    #authorize(principal: Principal): void {
        if (!hasPermission(principal, PERMISSIONS.manageSubmissions)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to handle form submissions.');
    }

    #repository(form: LoadedForm): ResourceRepository {
        return this.#host.resource(form.resource.id);
    }

    /**
     * Submissions newest first: those with a status, or new and read ones; or those whose text
     * matches a search, best first. Pages through `next`.
     */
    async list(form: LoadedForm, options: { status?: SubmissionStatus; search?: string; after?: string; limit?: number }, principal: Principal): Promise<SubmissionList> {
        this.#authorize(principal);
        const where = { status: options.status && STATUSES.has(options.status) ? options.status : { in: ['new', 'read'] } };
        const context = { principal };
        if (options.search?.trim()) {
            if (!Object.values(form.resource.fields).some(field => field.search)) return { items: [] };
            const found = await this.#repository(form).search(options.search.trim(), { where, limit: Math.min(options.limit ?? 50, 100) }, context);
            return { items: found.map(record => submissionOf(form.ref.id, record, form.ref.inputs)) };
        }
        const page = await this.#repository(form).list({ where, order: { field: 'createdAt', direction: 'desc' }, limit: Math.min(Math.max(options.limit ?? 50, 1), 100), ...(options.after ? { after: options.after } : {}) }, context);
        return { items: page.records.map(record => submissionOf(form.ref.id, record, form.ref.inputs)), ...(page.next ? { next: page.next } : {}) };
    }

    /** How many submissions have each status. */
    async counts(form: LoadedForm, principal: Principal): Promise<{ [K in SubmissionStatus]: number }> {
        this.#authorize(principal);
        const counts = await this.#repository(form).countMany(SUBMISSION_STATUSES.map(status => ({ where: { status } })), { principal });
        return Object.fromEntries(SUBMISSION_STATUSES.map((status, index) => [status, counts[index]!])) as { [K in SubmissionStatus]: number };
    }

    /**
     * New and kept (new and read) submissions of each form, for the navigation and the forms
     * list. Forms whose table cannot be read count 0.
     */
    async inboxCounts(forms: readonly LoadedForm[], principal: Principal): Promise<Map<string, { fresh: number; kept: number }>> {
        if (!hasPermission(principal, PERMISSIONS.manageSubmissions) || !forms.length) return new Map();
        const counts = new Map<string, { fresh: number; kept: number }>();
        for (let offset = 0; offset < forms.length; offset += 15) {
            const chunk = forms.slice(offset, offset + 15);
            try {
                const result = await this.#host.db.read(chunk.flatMap(form => [
                    { rql: `SELECT count(*) FROM ${form.resource.storage} WHERE status = 'new'` },
                    { rql: `SELECT count(*) FROM ${form.resource.storage} WHERE status IN ('new', 'read')` },
                ]));
                chunk.forEach((form, index) => counts.set(form.ref.id, { fresh: Number(result.results[index * 2]!.rows[0]![0] as bigint), kept: Number(result.results[index * 2 + 1]!.rows[0]![0] as bigint) }));
            } catch { for (const form of chunk) counts.set(form.ref.id, { fresh: 0, kept: 0 }); }
        }
        return counts;
    }

    async submission(form: LoadedForm, id: string, principal: Principal): Promise<SubmissionShape | null> {
        this.#authorize(principal);
        const record = await this.#repository(form).get(id, { principal });
        return record ? submissionOf(form.ref.id, record, form.ref.inputs) : null;
    }

    /** Mark submissions read, unread (`new`), spam or trash. Returns how many changed. */
    async setStatus(form: LoadedForm, ids: readonly string[], status: SubmissionStatus, principal: Principal): Promise<number> {
        this.#authorize(principal);
        if (!STATUSES.has(status)) throw new CmsError('CMS_VALIDATION', 'Unknown submission status.');
        await this.#host.assertActive(form.resource, { fresh: true });
        const storage = form.resource.storage;
        const now = this.#host.now();
        return this.#each(ids, (key, index) => bound(
            `UPDATE ${storage} SET status = $status, "_updatedAt" = $now, "_rev" = "_rev" + 1 WHERE id = type::record('${storage}', $k${index}) AND status != $status`,
            { $status: status, $now: now, [`$k${index}`]: key },
        ));
    }

    /** Delete submissions for good. Returns how many were deleted. */
    async delete(form: LoadedForm, ids: readonly string[], principal: Principal): Promise<number> {
        this.#authorize(principal);
        await this.#host.assertActive(form.resource, { fresh: true });
        const storage = form.resource.storage;
        return this.#each(ids, (key, index) => ({ rql: `DELETE FROM ${storage} WHERE id = type::record('${storage}', $k${index})`, params: { [`$k${index}`]: key } }));
    }

    async #each(ids: readonly string[], statement: (key: string, index: number) => Statement): Promise<number> {
        const keys = [...new Set(ids.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 100);
        let changed = 0;
        for (let offset = 0; offset < keys.length; offset += 25) {
            const result = await this.#host.db.write(keys.slice(offset, offset + 25).map((key, index) => statement(key, index)), WRITE);
            changed += result.results.reduce((sum, entry) => sum + Number(entry.affected), 0);
        }
        return changed;
    }

    /** Save a note on a submission, for whoever handles it. */
    async setNote(form: LoadedForm, id: string, note: string, principal: Principal): Promise<SubmissionShape> {
        this.#authorize(principal);
        const repository = this.#repository(form);
        const record = await repository.get(id, { principal });
        if (!record) throw new CmsError('CMS_NOT_FOUND', 'The submission is gone.');
        const updated = await repository.update(id, { note: note.trim() ? note.trim() : null }, { principal, expectedRevision: record.rev });
        return submissionOf(form.ref.id, updated, form.ref.inputs);
    }

    /**
     * Submissions as CSV, newest first, in pages: the time, the status, one column per input
     * with its label, then the details. Cells that spreadsheets would run as formulas are quoted.
     */
    async *csv(form: LoadedForm, options: { status?: SubmissionStatus }, principal: Principal): AsyncGenerator<string> {
        this.#authorize(principal);
        const inputs = form.ref.inputs;
        yield csvRow(['Submitted at', 'Status', ...inputs.map(input => input.label), 'IP address', 'Page', 'Browser', 'User', 'Note', 'ID']);
        let after: string | undefined;
        do {
            const page = await this.list(form, { ...(options.status ? { status: options.status } : {}), limit: 100, ...(after ? { after } : {}) }, principal);
            let rows = '';
            for (const item of page.items) {
                rows += csvRow([
                    new Date(item.createdAt).toISOString(), item.status, ...inputs.map(input => displayValue(input, item.values[input.name])),
                    item.meta.ip ?? '', item.meta.page ?? '', item.meta.userAgent ?? '', item.user ?? '', item.note, item.id,
                ]);
            }
            if (rows) yield rows;
            after = page.next;
        } while (after);
    }

    // --- Maintenance ----------------------------------------------------------------------

    /**
     * Forget sends after a day and sent-email records after 30 days, drop expired post
     * results, and empty each form's trash of submissions trashed over 30 days ago.
     */
    async maintain(): Promise<{ emptied: number }> {
        const now = this.#host.now();
        const old = await this.#host.db.read([
            { rql: 'SELECT 1 FROM cms_form_sends WHERE at < $before LIMIT 1', params: { $before: now - DAY } },
            { rql: 'SELECT 1 FROM cms_form_mail WHERE sent_at < $before LIMIT 1', params: { $before: now - 30 * DAY } },
            { rql: 'SELECT 1 FROM cms_form_results WHERE expires_at < $now LIMIT 1', params: { $now: now } },
        ]);
        const statements: Statement[] = [];
        if (old.results[0]!.rows.length) statements.push({ rql: 'DELETE FROM cms_form_sends WHERE at < $before', params: { $before: now - DAY } });
        if (old.results[1]!.rows.length) statements.push({ rql: 'DELETE FROM cms_form_mail WHERE sent_at < $before', params: { $before: now - 30 * DAY } });
        if (old.results[2]!.rows.length) statements.push({ rql: 'DELETE FROM cms_form_results WHERE expires_at < $now', params: { $now: now } });
        if (statements.length) await this.#host.db.write(statements, WRITE);
        let emptied = 0;
        for (const form of await this.all()) {
            const trashed = await this.#host.db.read([{ rql: `SELECT record::id(id) FROM ${form.resource.storage} WHERE status = 'trash' AND "_updatedAt" < $before LIMIT 500`, params: { $before: now - 30 * DAY } }]);
            const ids = trashed.results[0]!.rows.map(row => row[0] as string);
            if (ids.length) emptied += await this.delete(form, ids, SYSTEM);
        }
        return { emptied };
    }

    // --- Results of form posts ------------------------------------------------------------

    /** Keep what a form post returns to its page after the redirect, for ten minutes. Returns its key. */
    async saveResult(formId: string, data: unknown): Promise<string> {
        const id = crypto.randomUUID();
        await this.#host.db.write([{ rql: 'INSERT INTO cms_form_results (id, form_id, data, expires_at) VALUES ($id, $form, $data, $expires)', params: { $id: id, $form: formId, $data: JSON.stringify(data), $expires: this.#host.now() + 10 * 60_000 } }], WRITE);
        return id;
    }

    /** The result kept under a key for a form, once: reading it deletes it. */
    async takeResult(formId: string, id: string): Promise<unknown> {
        if (!/^[0-9a-f-]{36}$/.test(id)) return null;
        const result = await this.#host.db.read([{ rql: 'SELECT data FROM cms_form_results WHERE id = $id AND form_id = $form AND expires_at >= $now', params: { $id: id, $form: formId, $now: this.#host.now() } }]);
        const data = result.results[0]!.rows[0]?.[0];
        if (typeof data !== 'string') return null;
        await this.#host.db.write([{ rql: 'DELETE FROM cms_form_results WHERE id = $id', params: { $id: id } }], WRITE);
        try { return JSON.parse(data); } catch { return null; }
    }
}

/** One CSV line. Cells starting like a formula get a leading apostrophe. */
function csvRow(cells: readonly string[]): string {
    return `${cells.map(cell => {
        const text = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',')}\r\n`;
}

export type { FormErrors };
