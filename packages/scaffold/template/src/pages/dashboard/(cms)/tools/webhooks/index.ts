import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, WEBHOOK_EVENTS, type Webhook, type WebhookDelivery, type WebhookEvent } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

const EVENT_LABELS: Record<WebhookEvent, string> = {
    'entry.created': 'An entry is created', 'entry.updated': 'An entry changes', 'entry.published': 'An entry is published',
    'entry.unpublished': 'An entry is unpublished', 'entry.deleted': 'An entry is deleted',
};

interface Form { id: string; name: string; url: string; events: string[]; collections: string[]; active: boolean }
const EMPTY: Form = { id: '', name: '', url: '', events: ['entry.published', 'entry.unpublished'], collections: [], active: true };

/**
 * Webhooks post entry events to other services, such as a static site's build hook. Each
 * delivery is signed with the webhook's secret and retried with backoff when it fails.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageWebhooks)] })
export default class WebhooksPage extends Cossack {
    @State() hooks: Webhook[] = [];
    @State() collections: { name: string; label: string }[] = [];
    @State() form: Form = { ...EMPTY, events: [...EMPTY.events] };
    @State() deliveries: WebhookDelivery[] = [];
    @State() selected = '';
    @State() revealed = false;
    @State() error = '';
    @State() pendingDelete: Webhook | null = null;

    head(): HeadValue {
        return { title: __('Webhooks') };
    }

    async init() {
        this.collections = this.c.get('cms').collections().map(collection => ({ name: collection.name, label: collection.label }));
        await this.load(this.c.req.query('id') ?? '');
    }

    @Server()
    async load(id: string) {
        const cms = this.c.get('cms');
        this.hooks = await cms.webhooks.list();
        const hook = this.hooks.find(entry => entry.id === id);
        this.selected = hook?.id ?? '';
        this.revealed = false;
        this.form = hook ? { id: hook.id, name: hook.name, url: hook.url, events: [...hook.events], collections: [...hook.collections], active: hook.active } : { ...EMPTY, events: [...EMPTY.events] };
        this.deliveries = hook ? await cms.webhooks.deliveries(hook.id, 20) : [];
    }

    @Client()
    toggle(key: 'events' | 'collections', value: string, checked: boolean) {
        this.form = { ...this.form, [key]: checked ? [...new Set([...this.form[key], value])] : this.form[key].filter(entry => entry !== value) };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        const editing = Boolean(this.form.id);
        await this.save(this.form);
        if (this.error) toast.error(this.error); else toast.success(editing ? __('Webhook updated.') : __('Webhook added. Copy its secret to verify deliveries.'));
    }

    @Server()
    async save(form: Form) {
        this.error = '';
        const cms = this.c.get('cms');
        try {
            const principal = this.c.get('principal');
            const hook = await cms.webhooks.save({ name: form.name, url: form.url, events: form.events, collections: form.collections, active: form.active },
                { ...(form.id ? { id: form.id } : {}), by: principal.kind === 'user' ? principal.id : null, collections: cms.collections().map(collection => collection.name) });
            await this.load(hook.id);
            this.revealed = !form.id;
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The webhook could not be saved.');
        }
    }

    @Client()
    async test() {
        const result = await this.ping(this.selected);
        if (result.ok) toast.success(`${__('The receiver answered')} ${result.status}.`);
        else toast.error(result.error ?? __('The test failed.'));
    }

    @Server()
    async ping(id: string) {
        return this.c.get('cms').webhooks.ping(id);
    }

    @Server()
    async redeliver(deliveryId: string) {
        const cms = this.c.get('cms');
        await cms.webhooks.redeliver(deliveryId);
        await cms.webhooks.dispatch({ limit: 5 });
        this.deliveries = await cms.webhooks.deliveries(this.selected, 20);
    }

    @Server()
    async remove(id: string) {
        await this.c.get('cms').webhooks.delete(id);
        await this.load('');
    }

    render() {
        const hook = this.hooks.find(entry => entry.id === this.selected);
        return html`<div class="space-y-6">
            ${pageHeader(__('Webhooks'), { description: __('Tell other services when entries change, such as to rebuild a static site.'),
                actions: this.selected ? html`<a href="/dashboard/tools/webhooks" class="text-sm text-primary hover:underline">+ ${__('Add webhook')}</a>` : null })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div class="space-y-6">
                    ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${this.selected ? `${__('Edit')} ${hook?.name ?? ''}` : __('Add webhook')}</h2>`)}
                    ${component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Name'), for: 'hook-name', control: attributes => component(Input, { ...attributes, required: true, maxlength: 80, placeholder: __('Rebuild the site'),
                            '.value': this.form.name, '@input': (event: Event) => { this.form = { ...this.form, name: (event.target as HTMLInputElement).value }; } }) })}
                        ${component(Field, { label: __('URL'), for: 'hook-url', hint: __('HTTPS, or http://localhost while developing.'), control: attributes => component(Input, { ...attributes, type: 'url', required: true,
                            placeholder: 'https://api.example.com/hooks/cms', '.value': this.form.url, '@input': (event: Event) => { this.form = { ...this.form, url: (event.target as HTMLInputElement).value }; } }) })}
                        <fieldset class="space-y-2"><legend class="mb-1 text-sm font-medium text-foreground">${__('Events')}</legend>
                            ${WEBHOOK_EVENTS.map(event => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                ${component(Checkbox, { checked: this.form.events.includes(event), '@change': (change: Event) => this.toggle('events', event, (change.target as HTMLInputElement).checked) })}
                                ${__(EVENT_LABELS[event])} <code class="text-xs text-muted-foreground">${event}</code></label>`)}</fieldset>
                        <fieldset class="space-y-2"><legend class="mb-1 text-sm font-medium text-foreground">${__('Collections')}</legend>
                            <p class="text-xs text-muted-foreground">${__('None checked sends events of every collection.')}</p>
                            <div class="grid gap-2 sm:grid-cols-3">${this.collections.map(collection => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                ${component(Checkbox, { checked: this.form.collections.includes(collection.name), '@change': (change: Event) => this.toggle('collections', collection.name, (change.target as HTMLInputElement).checked) })} ${collection.label}</label>`)}</div></fieldset>
                        <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            ${component(Checkbox, { checked: this.form.active, '@change': (change: Event) => { this.form = { ...this.form, active: (change.target as HTMLInputElement).checked }; } })} ${__('Active')}</label>
                        <div class="flex flex-wrap gap-2">
                            ${component(Button, { type: 'submit' }, this.selected ? __('Save webhook') : __('Add webhook'))}
                            ${this.selected ? component(Button, { type: 'button', variant: 'outline', '@click': () => this.test() }, __('Send a test')) : null}
                            ${hook ? component(Button, { type: 'button', variant: 'ghost', class: 'text-destructive', '@click': () => { this.pendingDelete = hook; } }, __('Delete')) : null}
                        </div>
                    </form>`)}`)}
                    ${hook ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Recent deliveries')}</h2>`)}
                        ${component(CardBody, { class: 'p-0' }, this.deliveries.length ? html`<ul class="divide-y divide-border">${this.deliveries.map(delivery => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                            <span><code>${delivery.event}</code> <span class="text-muted-foreground">· ${shortDate(delivery.createdAt)} · ${__('attempts')}: ${delivery.attempts}</span>
                                ${delivery.error ? html`<span class="block text-xs text-destructive">${delivery.error}</span>` : null}</span>
                            <span class="flex items-center gap-2">${component(Badge, { variant: delivery.status === 'delivered' ? 'success' : delivery.status === 'failed' ? 'destructive' : 'secondary' },
                                delivery.status === 'delivered' ? `${__('Delivered')} ${delivery.responseStatus ?? ''}` : delivery.status === 'failed' ? __('Failed') : __('Pending'))}
                                ${delivery.status !== 'pending' ? html`<button type="button" class="text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.redeliver(delivery.id)}>${__('Send again')}</button>` : null}</span>
                        </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No deliveries yet.')}</p>`)}`) : null}
                </div>
                <aside class="space-y-4">
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`<h2 class="text-base font-semibold text-foreground">${__('Webhooks')}</h2>
                        ${this.hooks.length ? html`<ul class="space-y-2">${this.hooks.map(entry => html`<li><a href=${`/dashboard/tools/webhooks?id=${entry.id}`}
                            class=${`block rounded-md border px-3 py-2 no-underline ${entry.id === this.selected ? 'border-primary' : 'border-border hover:bg-muted'}`}>
                            <span class="flex items-center justify-between gap-2"><span class="truncate text-sm font-medium text-foreground">${entry.name}</span>
                                ${component(Badge, { variant: entry.active ? 'success' : 'secondary' }, entry.active ? __('Active') : __('Off'))}</span>
                            <span class="block truncate text-xs text-muted-foreground">${entry.url}</span></a></li>`)}</ul>` : html`<p class="text-sm text-muted-foreground">${__('No webhooks yet.')}</p>`}`))}
                    ${hook ? component(Card, {}, component(CardBody, { class: 'space-y-2' }, html`<h2 class="text-base font-semibold text-foreground">${__('Signing secret')}</h2>
                        <code class="block break-all rounded bg-muted px-2 py-1 text-xs">${this.revealed ? hook.secret : `${hook.secret.slice(0, 10)}${'•'.repeat(16)}`}</code>
                        ${this.revealed ? null : html`<button type="button" class="text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.revealed = true; }}>${__('Show')}</button>`}
                        <p class="text-xs text-muted-foreground">${__('Each delivery has X-Cossack-Signature: sha256= the HMAC-SHA256 of “timestamp.body” with this secret, and the timestamp in X-Cossack-Timestamp.')}</p>`)) : null}
                </aside>
            </div>
            ${component(AlertDialog, {
                id: 'delete-webhook-dialog', open: this.pendingDelete !== null, title: __('Delete this webhook?'),
                description: this.pendingDelete ? `${this.pendingDelete.name} ${__('stops receiving events, and its delivery history is deleted.')}` : '',
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { const item = this.pendingDelete; this.pendingDelete = null; if (item) void this.remove(item.id); }, onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
