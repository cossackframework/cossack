/**
 * A form's notifications, edited as a list: who gets each email, its subject and text with
 * merge tags, and when to send it. The field stores `{ rules: [...] }` as JSON text, as the
 * editor keeps JSON fields; the server checks the rules against the form's inputs. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, Input, Textarea } from '@cossackframework/ui';
import { blockId, MERGE_TAGS, NOTIFICATION_LIMIT, notificationRules, type NotificationRule } from '@cossackframework/cms';
import { conditionControl, conditionInput, type ConditionField } from './condition-control';

function rulesOf(text: string): NotificationRule[] {
    try { return text.trim() ? notificationRules(JSON.parse(text)) : []; } catch { return []; }
}

const textOf = (rules: readonly NotificationRule[]) => rules.length ? JSON.stringify({ rules }, null, 2) : '';

/** The rules control. `fields` are the form's inputs, for `{field:…}` tags and conditions. */
export function notificationRulesControl(text: string, fields: readonly ConditionField[], id: string, change: (text: string) => void): TemplateResult {
    const rules = rulesOf(text);
    const save = (next: readonly NotificationRule[]) => change(textOf(next.map(rule => {
        const when = conditionInput(rule.when);
        const { when: _when, ...rest } = rule;
        return when ? { ...rest, when } : rest;
    })));
    const set = (index: number, next: Partial<NotificationRule>) => save(rules.map((rule, at) => at === index ? { ...rule, ...next } : rule));
    const add = () => save([...rules, {
        id: blockId(), label: rules.length ? __('Notification') : __('Admin notification'), to: '{admin_email}',
        subject: `${__('New submission')}: {form:title}`, body: '{all_fields}\n\n{submission:url}',
    }]);
    const line = (index: number, key: 'label' | 'to' | 'replyTo' | 'subject', label: string, hint = '') => {
        const control = `${id}-${index}-${key}`;
        return html`<div class="min-w-0 space-y-1">
            <label for=${control} class="block text-xs font-medium text-foreground">${label}</label>
            ${component(Input, { id: control, size: 'sm', '.value': rules[index]![key] ?? '', '@input': (event: Event) => set(index, { [key]: (event.target as HTMLInputElement).value }) })}
            ${hint ? html`<p class="text-xs text-muted-foreground">${hint}</p>` : null}
        </div>`;
    };
    const tags = [...MERGE_TAGS.map(entry => ({ tag: entry.tag, label: __(entry.label) })), ...fields.map(field => ({ tag: `{field:${field.name}}`, label: field.label }))];
    return html`<div id=${id} class="space-y-3">
        ${rules.length ? null : html`<p class="text-sm text-muted-foreground">${__('No emails are sent for submissions.')}</p>`}
        ${rules.map((rule, index) => html`<fieldset class="space-y-3 rounded-md border border-border p-3" data-notification=${rule.id}>
            <legend class="sr-only">${rule.label}</legend>
            <div class="flex items-center justify-between gap-2">
                <label class="flex items-center gap-2 text-sm font-medium text-foreground">
                    ${component(Checkbox, { checked: rule.enabled !== false, '@change': (event: Event) => set(index, { enabled: (event.target as HTMLInputElement).checked }) })}
                    ${__('Send')} “${rule.label || __('Notification')}”</label>
                ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-label': `${__('Remove')} ${rule.label}`, '@click': () => save(rules.filter((_, at) => at !== index)) }, __('Remove'))}
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
                ${line(index, 'label', __('Name'))}
                ${line(index, 'to', __('Send to'), `${__('Addresses or tags, separated by commas, such as')} {admin_email} ${__('or an email field.')}`)}
                ${line(index, 'subject', __('Subject'))}
                ${line(index, 'replyTo', __('Reply to'), __('Optional, such as an email field.'))}
            </div>
            <div class="space-y-1">
                <label for=${`${id}-${index}-body`} class="block text-xs font-medium text-foreground">${__('Message')}</label>
                ${component(Textarea, { id: `${id}-${index}-body`, rows: 5, '.value': rule.body, '@input': (event: Event) => set(index, { body: (event.target as HTMLTextAreaElement).value }) })}
            </div>
            ${conditionControl(rule.when, fields, `${id}-${index}`, when => set(index, when ? { when } : { when: undefined }),
                { toggle: __('Send only when the answers match'), subject: __('this email'), show: __('Send'), hide: __('Do not send') })}
        </fieldset>`)}
        ${rules.length < NOTIFICATION_LIMIT ? component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': add }, __('Add notification')) : null}
        <details class="text-xs text-muted-foreground"><summary class="cursor-pointer">${__('Merge tags')}</summary>
            <ul class="mt-2 grid gap-1 sm:grid-cols-2">${tags.map(entry => html`<li><code class="text-foreground">${entry.tag}</code> ${entry.label}</li>`)}</ul>
        </details>
    </div>`;
}
