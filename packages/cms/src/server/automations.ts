/**
 * Automations run: the host turns its outbox events (entries, forms, payments) into variables
 * and asks this service to run the active automations that match. An email goes out as the
 * site. A failure is kept on the automation as its last error; one that can pass on another
 * try is thrown, so the outbox retries the delivery, and the automations that already sent for
 * it are skipped then. An automation emails what its event carries, so saving or switching one
 * on needs read access to that: the entries of its collection, or form submissions. It runs as
 * the user who did: with their permissions at the time it runs, and an entry without the fields
 * they may not read.
 */
import type { RomeDB } from '@cossackframework/romedb';
import type { BindingScopes } from '../bindings';
import { automationMatches, automationProblems, renderAutomationTemplate, type Automation, type AutomationAction, type AutomationConditions, type AutomationEvent, type AutomationInput } from '../automations';
import { CmsError } from '../errors';
import { hasPermission, PERMISSIONS, principalId, systemPrincipal, type Principal } from '../permissions';
import type { CmsMailer } from './mail';
import { randomToken } from './tokens';

const WRITE = { kind: 'cms.automations', retryConflicts: 5 } as const;
const COLUMNS = 'id, name, event, conditions, action, active, runs, last_run_at, last_error, created_at, updated_at, author';

export interface AutomationsOptions {
    readonly mail?: CmsMailer | null;
    readonly mailFrom?: string;
    readonly now?: () => number;
    readonly changed?: () => void | Promise<void>;
    /** The principal of an automation's author as of now, or null when they can no longer act (deleted, disabled). */
    readonly principal?: (userId: string) => Promise<Principal | null>;
    /** An entry as the principal may read it: without the fields they may not. */
    readonly redact?: (collection: string, record: Record<string, unknown>, principal: Principal) => Record<string, unknown>;
}

export class CmsAutomations {
    readonly #db: RomeDB;
    readonly #options: AutomationsOptions;
    readonly #now: () => number;

    constructor(db: RomeDB, options: AutomationsOptions = {}) {
        this.#db = db;
        this.#options = options;
        this.#now = options.now ?? Date.now;
    }

    async list(): Promise<Automation[]> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_automations ORDER BY created_at, id LIMIT 500` }]);
        return result.results[0]!.rows.map(rowOf);
    }

    async get(id: string): Promise<Automation | null> {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_automations WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? rowOf(row) : null;
    }

    /** Create or change an automation; problems are refused as `CMS_VALIDATION`, data the principal may not read as `CMS_FORBIDDEN`. */
    async save(input: AutomationInput, options: { id?: string; principal: Principal }): Promise<Automation> {
        const problems = automationProblems(input);
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        assertReads(options.principal, input.event, input.conditions?.collection);
        const now = this.#now();
        const conditions: AutomationConditions = { ...(input.conditions?.collection ? { collection: input.conditions.collection } : {}), ...(input.conditions?.form ? { form: input.conditions.form } : {}) };
        const action: AutomationAction = { kind: 'email', to: input.action.to.split(',').map(part => part.trim()).filter(Boolean).join(', '), subject: input.action.subject.trim(), text: input.action.text };
        const active = input.active !== false;
        if (options.id) {
            const current = await this.get(options.id);
            if (!current) throw new CmsError('CMS_NOT_FOUND', 'Automation not found.');
            await this.#db.write([{ rql: 'UPDATE cms_automations SET name = $name, event = $event, conditions = $conditions, action = $action, active = $active, updated_at = $now, author = $author WHERE id = $id',
                params: { $id: options.id, $name: input.name.trim(), $event: input.event, $conditions: JSON.stringify(conditions), $action: JSON.stringify(action), $active: active ? 1 : 0, $now: now, $author: authorOf(options.principal) } }], WRITE);
        } else {
            options = { ...options, id: randomToken(12) };
            await this.#db.write([{ rql: `INSERT INTO cms_automations (${COLUMNS}) VALUES ($id, $name, $event, $conditions, $action, $active, 0, NULL, '', $now, $now, $author)`,
                params: { $id: options.id!, $name: input.name.trim(), $event: input.event, $conditions: JSON.stringify(conditions), $action: JSON.stringify(action), $active: active ? 1 : 0, $now: now, $author: authorOf(options.principal) } }], WRITE);
        }
        await this.#options.changed?.();
        return (await this.get(options.id!))!;
    }

    async setActive(id: string, active: boolean, principal: Principal): Promise<boolean> {
        if (active) {
            const current = await this.get(id);
            if (current) assertReads(principal, current.event, current.conditions?.collection);
        }
        // Whoever switches one on takes it over: it runs as them from then on.
        const result = await this.#db.write([active
            ? { rql: 'UPDATE cms_automations SET active = 1, updated_at = $now, author = $author WHERE id = $id', params: { $id: id, $now: this.#now(), $author: authorOf(principal) } }
            : { rql: 'UPDATE cms_automations SET active = 0, updated_at = $now WHERE id = $id', params: { $id: id, $now: this.#now() } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    async delete(id: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_automations WHERE id = $id', params: { $id: id } }], WRITE);
        await this.#options.changed?.();
    }

    /**
     * Run every active automation of the event whose conditions hold. Each failure is recorded on
     * its automation; the first error is thrown after the rest ran, so the outbox retries the
     * delivery (an email sent before a failure is sent again then: keep actions idempotent at the receiver).
     */
    async run(event: AutomationEvent, vars: Record<string, unknown>, scopes: Omit<BindingScopes, 'entry'> = {}, delivery?: string): Promise<{ ran: string[]; failed: string[] }> {
        const ran: string[] = [];
        const failed: string[] = [];
        let first: unknown;
        const matching = (await this.list()).filter(entry => entry.active && automationMatches(entry, event, vars));
        // On a retry of the same delivery, the automations that sent already are done.
        const done = delivery && matching.length ? await this.#done(matching.map(entry => doneKey(entry.id, delivery))) : new Set<string>();
        for (const automation of matching) {
            const key = delivery ? doneKey(automation.id, delivery) : null;
            if (key && done.has(key)) continue;
            try {
                await this.#perform(automation, await this.#asAuthor(automation, event, vars), scopes);
                await this.#db.write([
                    { rql: "UPDATE cms_automations SET runs = runs + 1, last_run_at = $now, last_error = '' WHERE id = $id", params: { $id: automation.id, $now: this.#now() } },
                    ...(key ? [{ rql: "INSERT INTO cms_cache (key, value, expires_at) VALUES ($key, '1', $until) ON CONFLICT (key) DO NOTHING", params: { $key: key, $until: this.#now() + DONE_MS } }] : []),
                ], WRITE);
                ran.push(automation.id);
            } catch (error) {
                failed.push(automation.id);
                // Nothing to send to, or no sender: another try fails the same way, so it is only recorded.
                if (!(error instanceof AutomationSkipped)) first ??= error;
                await this.#db.write([{ rql: 'UPDATE cms_automations SET last_run_at = $now, last_error = $error WHERE id = $id', params: { $id: automation.id, $now: this.#now(), $error: String((error as Error)?.message ?? error).slice(0, 500) } }], WRITE).catch(() => undefined);
            }
        }
        if (first !== undefined) throw first;
        return { ran, failed };
    }

    async #done(keys: readonly string[]): Promise<Set<string>> {
        const result = await this.#db.read([{ rql: `SELECT key FROM cms_cache WHERE key IN (${keys.map((_, index) => `$k${index}`).join(', ')})`, params: Object.fromEntries(keys.map((key, index) => [`$k${index}`, key])) }]);
        return new Set(result.results[0]!.rows.map(row => row[0] as string));
    }

    /**
     * The event's variables as the automation's author may read them: refused when they can no
     * longer act or read what the event carries, and an entry without the fields they may not read.
     */
    async #asAuthor(automation: Automation, event: AutomationEvent, vars: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!this.#options.principal) return vars;
        const author = automation.author;
        const principal = !author ? null : author.startsWith('system:') ? systemPrincipal(author.slice('system:'.length)) : await this.#options.principal(author);
        if (!principal) throw new AutomationSkipped('Its author can no longer run it: switch it on again to run it as you.');
        try { assertReads(principal, event, automation.conditions?.collection); }
        catch (error) { throw new AutomationSkipped((error as Error).message); }
        const { record, collection } = vars;
        if (!record || typeof record !== 'object' || typeof collection !== 'string' || !this.#options.redact) return vars;
        return { ...vars, record: this.#options.redact(collection, record as Record<string, unknown>, principal) };
    }

    async #perform(automation: Automation, vars: Record<string, unknown>, scopes: Omit<BindingScopes, 'entry'>): Promise<void> {
        const action = automation.action;
        if (!this.#options.mail) throw new AutomationSkipped('No email sender is configured.');
        const recipients = renderAutomationTemplate(action.to, vars, scopes).split(',').map(part => part.trim()).filter(part => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));
        if (!recipients.length) throw new AutomationSkipped('No recipient: the address was empty.');
        for (const to of recipients) await this.#options.mail.send({ kind: 'automation', to, from: this.#options.mailFrom ?? 'no-reply@example.com', subject: renderAutomationTemplate(action.subject, vars, scopes).slice(0, 200), text: renderAutomationTemplate(action.text, vars, scopes) });
    }
}

/** Automations that sent for a delivery are remembered this long: past the outbox's retries. */
const DONE_MS = 8 * 24 * 60 * 60 * 1000;

function doneKey(id: string, delivery: string): string {
    return `automation:${id}:${delivery}`.slice(0, 200);
}

/** Who an automation runs as: a user's ID, or `system:<reason>` for host work (setup, imports, tests). */
function authorOf(principal: Principal): string | null {
    return principal.kind === 'anonymous' ? null : principalId(principal);
}

/** A failure another try would repeat: recorded on the automation, not retried. */
class AutomationSkipped extends Error {}

/** Whether the principal may read what an automation of this event sends: entries of the collection (all collections without one), or form submissions and payments. */
function assertReads(principal: Principal, event: AutomationEvent, collection: string | undefined): void {
    const permission = event === 'form.submitted' ? PERMISSIONS.manageSubmissions
        : event === 'payment.completed' ? PERMISSIONS.manageSettings
        : collection ? `cms/${collection}:read` : 'cms/*';
    if (!hasPermission(principal, permission)) throw new CmsError('CMS_FORBIDDEN', `This automation sends what you may not read (${permission}).`);
}

function rowOf(row: readonly unknown[]): Automation {
    return Object.freeze({
        id: row[0] as string, name: row[1] as string, event: row[2] as AutomationEvent, conditions: JSON.parse(row[3] as string) as AutomationConditions, action: JSON.parse(row[4] as string) as AutomationAction,
        active: Number(row[5] as bigint) === 1, runs: Number(row[6] as bigint), lastRunAt: row[7] === null ? null : Number(row[7] as bigint), lastError: (row[8] as string) ?? '',
        createdAt: Number(row[9] as bigint), updatedAt: Number(row[10] as bigint), author: (row[11] as string | null) ?? null,
    });
}
