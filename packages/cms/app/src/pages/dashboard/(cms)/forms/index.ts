import { Client, Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { evaluateRule, hasPermission, isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { bulkBar, type BulkChoice } from '../../../../dashboard/bulk';
import { listTable, rowActions } from '../../../../dashboard/list-table';
import { icon } from '../../../../cms/icons';
import { requireAny } from '../../../../cms/guards';
import { linkButton, notice, pageHeader } from '../../../../cms/ui';

/** What a bulk action writes to each selected form. */
const BULK_PATCHES: Record<string, Record<string, unknown>> = {
    on: { enabled: true }, off: { enabled: false }, publish: { status: 'published' }, draft: { status: 'draft' },
};

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
    @State() canDelete = false;
    @State() selected: string[] = [];
    @State() bulk = '';
    /** A bulk action waiting for confirmation. */
    @State() pendingBulk: BulkChoice | null = null;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: __('Forms') };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const access = cms.resourceById('cms/forms').access;
        this.canCreate = evaluateRule(access.create, principal) !== 'deny';
        this.canEdit = evaluateRule(access.update, principal) !== 'deny';
        this.canDelete = evaluateRule(access.delete, principal) !== 'deny';
        this.canHandle = hasPermission(principal, PERMISSIONS.manageSubmissions);
        await this.load();
    }

    private async load() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const forms = await cms.forms.all();
        const counts = await cms.forms.inboxCounts(forms, principal);
        const closed = await Promise.all(forms.map(form => cms.forms.closed(form)));
        this.rows = forms.map((form, index) => ({
            id: form.ref.id, title: form.ref.title || __('(no title)'), slug: form.ref.slug, fields: form.ref.inputs.length,
            fresh: counts.get(form.ref.id)?.fresh ?? 0, kept: counts.get(form.ref.id)?.kept ?? 0, closed: closed[index] ?? '', enabled: form.enabled, published: form.published,
        }));
        this.selected = this.selected.filter(id => this.rows.some(row => row.id === id));
    }

    /** Status changes for editors, deletion for those who may delete forms. */
    private bulkChoices(): BulkChoice[] {
        return [
            ...(this.canEdit ? [{ key: 'on', label: __('Accept submissions') }, { key: 'off', label: __('Stop submissions') }, { key: 'publish', label: __('Publish') }, { key: 'draft', label: __('Unpublish') }] : []),
            ...(this.canDelete ? [{ key: 'delete', label: __('Delete'), confirm: __('The selected forms will be deleted. Their kept submissions stay in the inbox. This cannot be undone.') }] : []),
        ];
    }

    @Client()
    async submitBulk() {
        const choice = this.bulkChoices().find(entry => entry.key === this.bulk);
        if (!choice || !this.selected.length) return;
        if (choice.confirm) { this.pendingBulk = choice; return; }
        await this.runBulk(choice.key);
    }

    @Client()
    async runBulk(key: string) {
        this.pendingBulk = null;
        await this.applyBulk(this.selected, key);
    }

    /** Apply a bulk action form by form; the repository checks each write against the forms' access rules. */
    @Server()
    async applyBulk(ids: string[], key: string) {
        this.message = '';
        this.error = '';
        const patch = BULK_PATCHES[key];
        if (key !== 'delete' && !patch) return;
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const repository = cms.resource('cms/forms');
        const failures: string[] = [];
        let done = 0;
        for (const id of [...new Set(ids)].slice(0, 100)) {
            try {
                const record = await repository.get(id, { principal });
                if (!record) continue;
                if (patch) await repository.update(id, patch, { principal, expectedRevision: record.rev }); else await repository.delete(id, { principal, expectedRevision: record.rev });
                done++;
            } catch (error) { failures.push(isCmsError(error) ? error.message : __('A form could not be changed.')); }
        }
        if (done) this.message = `${done} ${done === 1 ? __('form updated.') : __('forms updated.')}`;
        if (failures.length) this.error = [...new Set(failures)].slice(0, 3).join(' ');
        this.selected = [];
        this.bulk = '';
        await this.load();
    }

    private status(row: Row): TemplateResult {
        return !row.published ? component(Badge, { variant: 'outline' }, __('Draft'))
            : !row.enabled ? component(Badge, { variant: 'secondary' }, __('Off'))
            : row.closed ? component(Badge, { variant: 'warning' }, __('Closed')) : component(Badge, { variant: 'success' }, __('Accepting'));
    }

    render() {
        const bulk = this.bulkChoices().length > 0;
        const submissions = (row: Row) => `/dashboard/forms/${row.id}/submissions`;
        return html`<div class="space-y-6">
            ${pageHeader(__('Forms'), {
                description: __('Build forms from blocks. Place one on a page with the Form block.'),
                titleActions: this.canCreate ? linkButton(__('New form'), '/dashboard/content/forms/new', 'primary', { size: 'sm' }) : null,
            })}
            ${this.message && !this.error ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.rows.length && bulk ? bulkBar({ id: 'forms-bulk', choices: this.bulkChoices(), value: this.bulk, count: this.selected.length,
                choose: key => { this.bulk = key; }, apply: () => this.submitBulk() }) : null}
            ${listTable<Row>({
                rows: this.rows, key: row => row.id, rowAttribute: 'data-form-id', empty: __('No forms yet.'),
                ...(bulk ? { selection: { selected: this.selected, label: row => row.title, change: ids => { this.selected = ids; } } } : {}),
                columns: [
                    { label: __('Title'), cell: row => html`<span data-form=${row.slug}>${this.canEdit ? html`<a href=${`/dashboard/content/forms/${row.id}`} class="font-medium text-foreground no-underline hover:text-primary">${row.title}</a>` : html`<span class="font-medium text-foreground">${row.title}</span>`}</span>
                        ${rowActions([
                            ...(this.canEdit ? [{ id: `form-${row.id}-edit`, label: __('Edit'), icon: icon('pen'), href: `/dashboard/content/forms/${row.id}` }] : []),
                            ...(this.canHandle ? [{ id: `form-${row.id}-submissions`, label: __('Submissions'), icon: icon('inbox'), href: submissions(row) }] : []),
                        ])}` },
                    { label: __('Slug'), cell: row => html`<code class="text-xs">${row.slug}</code>` },
                    { label: __('Fields'), class: 'text-muted-foreground', cell: row => row.fields },
                    { label: __('Submissions'), cell: row => this.canHandle ? html`<a href=${submissions(row)} class="text-foreground no-underline hover:text-primary">${row.kept}</a>
                        ${row.fresh ? html` <a href=${`${submissions(row)}?status=new`} class="no-underline">${component(Badge, { variant: 'default' }, `${row.fresh} ${__('new')}`)}</a>` : null}` : html`<span class="text-muted-foreground">—</span>` },
                    { label: __('Status'), cell: row => this.status(row) },
                ],
            })}
            ${component(AlertDialog, {
                id: 'bulk-forms-dialog',
                open: this.pendingBulk !== null,
                // Closed dialogs still need their labels.
                title: this.pendingBulk ? `${this.pendingBulk.label} ${this.selected.length} ${this.selected.length === 1 ? __('form') : __('forms')}?` : __('Apply'),
                description: this.pendingBulk?.confirm ?? '',
                cancelLabel: __('Cancel'),
                actionLabel: this.pendingBulk?.label || __('Apply'),
                actionVariant: this.pendingBulk?.key === 'delete' ? 'destructive' : 'primary',
                onAction: () => { if (this.pendingBulk) void this.runBulk(this.pendingBulk.key); },
                onOpenChange: () => { this.pendingBulk = null; },
            })}
        </div>`;
    }
}
