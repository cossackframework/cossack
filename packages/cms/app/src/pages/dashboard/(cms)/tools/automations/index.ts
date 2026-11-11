import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect, Textarea } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { AUTOMATION_EVENT_LABELS, AUTOMATION_EVENTS, isCmsError, PERMISSIONS, type Automation, type AutomationEvent } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { linkButton, notice, pageHeader, shortDate } from '../../../../../cms/ui';

interface Form { id: string; name: string; event: AutomationEvent; collection: string; form: string; to: string; subject: string; text: string; active: boolean }
const EMPTY: Form = { id: '', name: '', event: 'entry.published', collection: '', form: '', to: '', subject: '{{ $.title }} was published', text: '{{ $.title }}\n{{ $.url }}', active: true };

/**
 * Tools → Automations: when something happens on the site (an entry is published, a form is
 * submitted, a payment completes), send an email. Templates take the event's variables as
 * {{ $.title }}, {{ $.url }}, {{ $.collection }}, {{ $.values.email }}, {{ $.customerEmail }}. Runs ride
 * the outbox, so a failing action is retried and its last error is shown here. Posting the
 * same events to a URL is Tools → Webhooks.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class AutomationsPage extends Cossack {
    @State() items: Automation[] = [];
    @State() collections: { name: string; label: string }[] = [];
    @State() forms: { slug: string; title: string }[] = [];
    @State() form: Form = { ...EMPTY };
    @State() error = '';
    @State() message = '';

    head(): HeadValue {
        return { title: 'Automations' };
    }

    async init() {
        const cms = this.c.get('cms');
        this.collections = cms.collections().filter(collection => !collection.managed && collection.name !== 'forms').map(collection => ({ name: collection.name, label: collection.label }));
        this.forms = (await cms.forms.all().catch(() => [])).map(form => ({ slug: String(form.record.slug ?? ''), title: String(form.record.title ?? form.record.slug ?? '') })).filter(form => form.slug);
        await this.load(this.c.req.query('id') ?? '');
    }

    @Server()
    async load(id: string) {
        const cms = this.c.get('cms');
        this.items = await cms.automations.list();
        const found = this.items.find(entry => entry.id === id);
        this.form = found ? { id: found.id, name: found.name, event: found.event, collection: found.conditions?.collection ?? '', form: found.conditions?.form ?? '',
            to: found.action.to ?? '', subject: found.action.subject ?? '', text: found.action.text ?? '', active: found.active } : { ...EMPTY };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        this.message = '';
        await this.save(this.form);
        if (!this.error) this.message = this.form.id ? __('Automation saved.') : __('Automation added.');
    }

    @Server()
    async save(form: Form) {
        this.error = '';
        const cms = this.c.get('cms');
        try {
            const saved = await cms.automations.save({
                name: form.name, event: form.event, active: form.active,
                conditions: { ...(form.collection ? { collection: form.collection } : {}), ...(form.form ? { form: form.form } : {}) },
                action: { kind: 'email', to: form.to, subject: form.subject, text: form.text },
            }, { ...(form.id ? { id: form.id } : {}), principal: this.c.get('principal') });
            await this.load(saved.id);
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
        }
    }

    @Server()
    async toggle(id: string, active: boolean) {
        this.error = '';
        try { await this.c.get('cms').automations.setActive(id, active, this.c.get('principal')); }
        catch (error) { if (!isCmsError(error)) throw error; this.error = error.message; }
        await this.load(this.form.id);
    }

    @Server()
    async remove(id: string) {
        await this.c.get('cms').automations.delete(id);
        await this.load('');
    }

    render() {
        const input = (key: keyof Form, label: string, extra: Record<string, unknown> = {}) => component(Field, { label, for: `automation-${key}`, control: attributes => component(Input, { ...attributes, ...extra, '.value': String(this.form[key] ?? ''), '@input': (event: Event) => { this.form = { ...this.form, [key]: (event.target as HTMLInputElement).value }; } }) });
        const select = (key: keyof Form, label: string, options: readonly { value: string; label: string }[], hint?: string) => component(Field, { label, for: `automation-${key}`, ...(hint ? { hint } : {}), control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.form = { ...this.form, [key]: (event.target as HTMLSelectElement).value } as Form; } }, html`
            ${options.map(option => html`<option value=${option.value} ?selected=${this.form[key] === option.value}>${option.label}</option>`)}`) });
        const entryEvent = this.form.event.startsWith('entry.');
        return html`<div class="space-y-6">
            ${pageHeader(__('Automations'), { description: __('When something happens on the site, send an email. Runs are retried like other background work. To post events to a URL, add a webhook.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
                ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Automations')}</h2>`)}
                    ${component(CardBody, { class: 'p-0' }, this.items.length ? html`<ul class="divide-y divide-border" data-testid="automations">${this.items.map(item => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm" data-automation=${item.id}>
                        <span><a href=${`/dashboard/tools/automations?id=${item.id}`} class="font-medium text-foreground hover:underline">${item.name}</a> ${component(Badge, { variant: item.active ? 'success' : 'secondary' }, item.active ? __('On') : __('Off'))}
                            <span class="block text-xs text-muted-foreground">${__(AUTOMATION_EVENT_LABELS[item.event])}${item.conditions?.collection ? ` · ${item.conditions.collection}` : ''}${item.conditions?.form ? ` · ${item.conditions.form}` : ''} → ${__('email')} ${item.action.to ?? ''}
                                · ${item.runs} ${__('run(s)')}${item.lastRunAt ? ` · ${__('last')} ${shortDate(item.lastRunAt)}` : ''}</span>
                            ${item.lastError ? html`<span class="block text-xs text-destructive">${item.lastError}</span>` : null}</span>
                        <span class="flex gap-2">
                            <button type="button" class="text-xs text-foreground hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.toggle(item.id, !item.active)}>${item.active ? __('Turn off') : __('Turn on')}</button>
                            <button type="button" class="text-xs text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.remove(item.id)}>${__('Delete')}</button></span>
                    </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No automations yet. Add one on the right.')}</p>`)}`)}
                ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${this.form.id ? __('Edit automation') : __('New automation')}</h2>`)}
                    ${component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${input('name', __('Name'), { required: true, maxlength: 120 })}
                        ${select('event', __('When'), AUTOMATION_EVENTS.map(event => ({ value: event, label: __(AUTOMATION_EVENT_LABELS[event]) })))}
                        ${entryEvent ? select('collection', __('Only this collection'), [{ value: '', label: __('Any collection') }, ...this.collections.map(collection => ({ value: collection.name, label: collection.label }))]) : null}
                        ${this.form.event === 'form.submitted' ? select('form', __('Only this form'), [{ value: '', label: __('Any form') }, ...this.forms.map(form => ({ value: form.slug, label: form.title }))]) : null}
                        ${input('to', __('To'), { required: true, placeholder: 'editor@example.com, {{ $.customerEmail }}' })}
                        ${input('subject', __('Subject'), { required: true, maxlength: 200 })}
                        ${component(Field, { label: __('Text'), for: 'automation-text', hint: __('Variables: {{ $.title }}, {{ $.url }}, {{ $.collection }}, {{ $.status }}, {{ $.values.<field> }} for forms, {{ $.amount }}, {{ $.customerEmail }}, {{ $.reference }} for payments; {{ $site.title }} and {{ $user.name }} as in content.'),
                            control: attributes => component(Textarea, { ...attributes, rows: 5, required: true, '.value': this.form.text, '@input': (event: Event) => { this.form = { ...this.form, text: (event.target as HTMLTextAreaElement).value }; } }) })}
                        ${component(Checkbox, { label: __('Active'), checked: this.form.active, '@change': (event: Event) => { this.form = { ...this.form, active: (event.target as HTMLInputElement).checked }; } })}
                        <div class="flex flex-wrap items-center gap-2">${component(Button, { type: 'submit' }, this.form.id ? __('Save') : __('Add automation'))}${this.form.id ? linkButton(__('New'), '/dashboard/tools/automations', 'outline') : null}</div>
                    </form>`)}`)}
            </div>
        </div>`;
    }
}
