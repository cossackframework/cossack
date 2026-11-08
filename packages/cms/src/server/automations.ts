/**
 * Automations run: the host turns its outbox events (entries, forms, payments) into variables
 * and asks this service to run the active automations that match. An email goes out as the
 * site. A failure is kept on the automation as its last error and thrown, so the outbox
 * retries the delivery.
 */
import type { RomeDB } from '@cossackframework/romedb';
import { automationMatches, automationProblems, renderAutomationTemplate, type Automation, type AutomationAction, type AutomationConditions, type AutomationEvent, type AutomationInput } from '../automations';
import { CmsError } from '../errors';
import type { CmsMailer } from './mail';
import { randomToken } from './tokens';

const WRITE = { kind: 'cms.automations', retryConflicts: 5 } as const;
const COLUMNS = 'id, name, event, conditions, action, active, runs, last_run_at, last_error, created_at, updated_at';

export interface AutomationsOptions {
    readonly mail?: CmsMailer | null;
    readonly mailFrom?: string;
    readonly now?: () => number;
    readonly changed?: () => void | Promise<void>;
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

    /** Create or change an automation; problems are refused as `CMS_VALIDATION`. */
    async save(input: AutomationInput, options: { id?: string } = {}): Promise<Automation> {
        const problems = automationProblems(input);
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        const now = this.#now();
        const conditions: AutomationConditions = { ...(input.conditions?.collection ? { collection: input.conditions.collection } : {}), ...(input.conditions?.form ? { form: input.conditions.form } : {}) };
        const action: AutomationAction = { kind: 'email', to: input.action.to.split(',').map(part => part.trim()).filter(Boolean).join(', '), subject: input.action.subject.trim(), text: input.action.text };
        const active = input.active !== false;
        if (options.id) {
            const current = await this.get(options.id);
            if (!current) throw new CmsError('CMS_NOT_FOUND', 'Automation not found.');
            await this.#db.write([{ rql: 'UPDATE cms_automations SET name = $name, event = $event, conditions = $conditions, action = $action, active = $active, updated_at = $now WHERE id = $id',
                params: { $id: options.id, $name: input.name.trim(), $event: input.event, $conditions: JSON.stringify(conditions), $action: JSON.stringify(action), $active: active ? 1 : 0, $now: now } }], WRITE);
        } else {
            options = { id: randomToken(12) };
            await this.#db.write([{ rql: `INSERT INTO cms_automations (${COLUMNS}) VALUES ($id, $name, $event, $conditions, $action, $active, 0, NULL, '', $now, $now)`,
                params: { $id: options.id!, $name: input.name.trim(), $event: input.event, $conditions: JSON.stringify(conditions), $action: JSON.stringify(action), $active: active ? 1 : 0, $now: now } }], WRITE);
        }
        await this.#options.changed?.();
        return (await this.get(options.id!))!;
    }

    async setActive(id: string, active: boolean): Promise<boolean> {
        const result = await this.#db.write([{ rql: 'UPDATE cms_automations SET active = $active, updated_at = $now WHERE id = $id', params: { $id: id, $active: active ? 1 : 0, $now: this.#now() } }], WRITE);
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
    async run(event: AutomationEvent, vars: Record<string, unknown>): Promise<{ ran: string[]; failed: string[] }> {
        const ran: string[] = [];
        const failed: string[] = [];
        let first: unknown;
        for (const automation of (await this.list()).filter(entry => entry.active && automationMatches(entry, event, vars))) {
            try {
                await this.#perform(automation, vars);
                await this.#db.write([{ rql: "UPDATE cms_automations SET runs = runs + 1, last_run_at = $now, last_error = '' WHERE id = $id", params: { $id: automation.id, $now: this.#now() } }], WRITE);
                ran.push(automation.id);
            } catch (error) {
                failed.push(automation.id);
                first ??= error;
                await this.#db.write([{ rql: 'UPDATE cms_automations SET last_run_at = $now, last_error = $error WHERE id = $id', params: { $id: automation.id, $now: this.#now(), $error: String((error as Error)?.message ?? error).slice(0, 500) } }], WRITE).catch(() => undefined);
            }
        }
        if (first !== undefined) throw first;
        return { ran, failed };
    }

    async #perform(automation: Automation, vars: Record<string, unknown>): Promise<void> {
        const action = automation.action;
        if (!this.#options.mail) throw new Error('No email sender is configured.');
        const recipients = renderAutomationTemplate(action.to, vars).split(',').map(part => part.trim()).filter(part => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));
        if (!recipients.length) throw new Error('No recipient: the address was empty.');
        for (const to of recipients) await this.#options.mail.send({ kind: 'automation', to, from: this.#options.mailFrom ?? 'no-reply@example.com', subject: renderAutomationTemplate(action.subject, vars).slice(0, 200), text: renderAutomationTemplate(action.text, vars) });
    }
}

function rowOf(row: readonly unknown[]): Automation {
    return Object.freeze({
        id: row[0] as string, name: row[1] as string, event: row[2] as AutomationEvent, conditions: JSON.parse(row[3] as string) as AutomationConditions, action: JSON.parse(row[4] as string) as AutomationAction,
        active: Number(row[5] as bigint) === 1, runs: Number(row[6] as bigint), lastRunAt: row[7] === null ? null : Number(row[7] as bigint), lastError: (row[8] as string) ?? '',
        createdAt: Number(row[9] as bigint), updatedAt: Number(row[10] as bigint),
    });
}
