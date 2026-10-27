import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { evaluateRule, hasPermission, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { linkButton, pageHeader } from '../../../../cms/ui';

interface Row {
    id: string;
    title: string;
    slug: string;
    fields: number;
    fresh: number;
    kept: number;
    /** Why the form takes nothing now; empty while it is open. */
    closed: string;
    enabled: boolean;
    published: boolean;
}

/**
 * Forms, as Gravity Forms lists them: each with its new and kept submissions and whether it
 * takes submissions now. Editing opens the entry editor; submissions open the inbox.
 */
@Page({ transport: 'http', middlewares: [requireAny('cms/forms:read', 'cms/forms:update', 'cms/forms:create', PERMISSIONS.manageSubmissions)] })
export default class FormsPage extends Cossack {
    @State() rows: Row[] = [];
    @State() canEdit = false;
    @State() canCreate = false;
    @State() canHandle = false;

    head(): HeadValue {
        return { title: __('Forms') };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const access = cms.resourceById('cms/forms').access;
        this.canCreate = evaluateRule(access.create, principal) !== 'deny';
        this.canEdit = evaluateRule(access.update, principal) !== 'deny';
        this.canHandle = hasPermission(principal, PERMISSIONS.manageSubmissions);
        const forms = await cms.forms.all();
        const counts = await cms.forms.inboxCounts(forms, principal);
        const closed = await Promise.all(forms.map(form => cms.forms.closed(form)));
        this.rows = forms.map((form, index) => ({
            id: form.ref.id, title: form.ref.title || __('(no title)'), slug: form.ref.slug, fields: form.ref.inputs.length,
            fresh: counts.get(form.ref.id)?.fresh ?? 0, kept: counts.get(form.ref.id)?.kept ?? 0, closed: closed[index] ?? '', enabled: form.enabled, published: form.published,
        }));
    }

    private row(row: Row): TemplateResult {
        const status = !row.published ? component(Badge, { variant: 'outline' }, __('Draft'))
            : !row.enabled ? component(Badge, { variant: 'secondary' }, __('Off'))
            : row.closed ? component(Badge, { variant: 'warning' }, __('Closed')) : component(Badge, { variant: 'success' }, __('Accepting'));
        const submissions = `/dashboard/forms/${row.id}/submissions`;
        return html`<tr class="border-b border-border last:border-0 align-top" data-form=${row.slug}>
            <td class="px-3 py-2">
                ${this.canEdit ? html`<a href=${`/dashboard/content/forms/${row.id}`} class="font-medium text-foreground hover:text-primary">${row.title}</a>` : html`<span class="font-medium text-foreground">${row.title}</span>`}
                <div class="mt-1 flex flex-wrap gap-x-3 text-xs">
                    ${this.canEdit ? html`<a href=${`/dashboard/content/forms/${row.id}`} class="text-primary hover:underline">${__('Edit')}</a>` : null}
                    ${this.canHandle ? html`<a href=${submissions} class="text-primary hover:underline">${__('Submissions')}</a>` : null}
                </div>
            </td>
            <td class="px-3 py-2"><code class="text-xs">${row.slug}</code></td>
            <td class="px-3 py-2 text-muted-foreground">${row.fields}</td>
            <td class="px-3 py-2">${this.canHandle ? html`<a href=${submissions} class="text-foreground no-underline hover:text-primary">${row.kept}</a>
                ${row.fresh ? html` <a href=${`${submissions}?status=new`} class="no-underline">${component(Badge, { variant: 'default' }, `${row.fresh} ${__('new')}`)}</a>` : null}` : html`<span class="text-muted-foreground">—</span>`}</td>
            <td class="px-3 py-2">${status}</td>
        </tr>`;
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Forms'), {
                description: __('Build forms from blocks. Place one on a page with the Form block and its slug.'),
                actions: this.canCreate ? linkButton(__('Add new form'), '/dashboard/content/forms/new') : null,
            })}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="px-3 py-2 font-medium">${__('Title')}</th><th class="px-3 py-2 font-medium">${__('Slug')}</th><th class="px-3 py-2 font-medium">${__('Fields')}</th>
                    <th class="px-3 py-2 font-medium">${__('Submissions')}</th><th class="px-3 py-2 font-medium">${__('Status')}</th>
                </tr></thead>
                <tbody>${this.rows.map(row => this.row(row))}</tbody></table>
                ${this.rows.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No forms yet.')}</p>`}</div>`))}
        </div>`;
    }
}
