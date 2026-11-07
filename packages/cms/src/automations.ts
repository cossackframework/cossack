/**
 * Automations: "when this happens, do that", kept as data and run from the outbox events the
 * CMS already delivers. An automation names an event, optional conditions, and one action:
 * an email from the site, or a signed webhook. Templates fill `{{ name }}` from the event's
 * variables. Pure shapes and checks; the server module runs them.
 */

export const AUTOMATION_EVENTS = Object.freeze(['entry.published', 'entry.created', 'entry.updated', 'entry.deleted', 'form.submitted', 'payment.completed'] as const);
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export const AUTOMATION_EVENT_LABELS: Readonly<Record<AutomationEvent, string>> = Object.freeze({
    'entry.published': 'An entry is published', 'entry.created': 'An entry is created', 'entry.updated': 'An entry changes', 'entry.deleted': 'An entry is deleted',
    'form.submitted': 'A form is submitted', 'payment.completed': 'A payment is completed',
});

export interface AutomationConditions {
    /** For entry events: only this collection. */
    readonly collection?: string;
    /** For form events: only this form, by slug. */
    readonly form?: string;
}

export type AutomationAction =
    | { readonly kind: 'email'; readonly to: string; readonly subject: string; readonly text: string }
    | { readonly kind: 'webhook'; readonly url: string; readonly secret?: string };

export interface AutomationInput {
    readonly name: string;
    readonly event: AutomationEvent;
    readonly conditions?: AutomationConditions;
    readonly action: AutomationAction;
    readonly active?: boolean;
}

export interface Automation extends AutomationInput {
    readonly id: string;
    readonly active: boolean;
    readonly runs: number;
    readonly lastRunAt: number | null;
    readonly lastError: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

const EMAIL = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|\{\{\s*[a-zA-Z0-9_.]+\s*\}\})$/;
const URL_OK = /^https:\/\/[^\s]{1,2000}$/;
const NAME = /^[a-z][a-z0-9_]{0,40}$/;

/** What is wrong with an automation, as sentences; empty when it can be saved. */
export function automationProblems(input: unknown): string[] {
    const problems: string[] = [];
    if (!input || typeof input !== 'object') return ['The automation must be an object.'];
    const value = input as Record<string, unknown>;
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) problems.push('Name the automation in 1 to 120 characters.');
    if (!(AUTOMATION_EVENTS as readonly string[]).includes(value.event as string)) problems.push(`Choose an event: ${AUTOMATION_EVENTS.join(', ')}.`);
    const conditions = value.conditions as Record<string, unknown> | undefined;
    if (conditions !== undefined) {
        if (!conditions || typeof conditions !== 'object') problems.push('Conditions must be an object.');
        else {
            if (conditions.collection !== undefined && conditions.collection !== '' && (typeof conditions.collection !== 'string' || !NAME.test(conditions.collection))) problems.push('The collection condition must be a collection name.');
            if (conditions.form !== undefined && conditions.form !== '' && (typeof conditions.form !== 'string' || !/^[a-z0-9-]{1,120}$/.test(conditions.form))) problems.push('The form condition must be a form slug.');
        }
    }
    const action = value.action as Record<string, unknown> | undefined;
    if (!action || typeof action !== 'object') problems.push('Choose an action.');
    else if (action.kind === 'email') {
        const recipients = String(action.to ?? '').split(',').map(part => part.trim()).filter(Boolean);
        if (!recipients.length || recipients.length > 10 || recipients.some(part => !EMAIL.test(part))) problems.push('Email: up to ten addresses, or a {{ variable }} such as {{ customerEmail }}.');
        if (typeof action.subject !== 'string' || !action.subject.trim() || action.subject.length > 200) problems.push('Email: a subject of 1 to 200 characters.');
        if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 20_000) problems.push('Email: a text of up to 20,000 characters.');
    } else if (action.kind === 'webhook') {
        if (typeof action.url !== 'string' || !URL_OK.test(action.url)) problems.push('Webhook: an https URL.');
        if (action.secret !== undefined && action.secret !== '' && (typeof action.secret !== 'string' || action.secret.length < 8 || action.secret.length > 200)) problems.push('Webhook: a secret of 8 to 200 characters, or none.');
    } else problems.push('The action is email or webhook.');
    if (value.active !== undefined && typeof value.active !== 'boolean') problems.push('active is true or false.');
    return problems;
}

/** Fill `{{ name }}` and `{{ a.b }}` from the variables; unknown names become empty. */
export function renderAutomationTemplate(template: string, vars: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
        const value = path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, vars);
        return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

/** Whether the automation's conditions hold for the variables of an event. */
export function automationMatches(automation: Pick<Automation, 'event' | 'conditions'>, event: AutomationEvent, vars: Record<string, unknown>): boolean {
    if (automation.event !== event) return false;
    const conditions = automation.conditions ?? {};
    if (conditions.collection && vars.collection !== conditions.collection) return false;
    if (conditions.form && vars.form !== conditions.form) return false;
    return true;
}
