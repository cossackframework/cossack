import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Checkbox, Field, Input, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

/** Rename a taxonomy, change its URL, or delete it with its terms. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class EditTaxonomy extends Cossack {
    @State() draft = { name: '', label: '', singular: '', description: '', path: '', hierarchical: false, builtin: false };
    @State() error = '';

    head(): HeadValue {
        return { title: this.draft.label || __('Taxonomy') };
    }

    async init() {
        try {
            const taxonomy = this.c.get('cms').taxonomies.declaration(this.c.req.param('name') ?? '');
            this.draft = { name: taxonomy.name, label: taxonomy.label, singular: taxonomy.singular, description: taxonomy.description ?? '', path: taxonomy.path ?? '', hierarchical: taxonomy.hierarchical, builtin: taxonomy.builtin === true };
        } catch { this.error = __('This taxonomy does not exist.'); this.c.status(404); }
    }

    @Client()
    setDraft<K extends keyof EditTaxonomy['draft']>(key: K, value: EditTaxonomy['draft'][K]) {
        this.draft = { ...this.draft, [key]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.draft);
        if (this.error) toast.error(this.error); else toast.success(__('Taxonomy saved.'));
    }

    @Server()
    async save(draft: EditTaxonomy['draft']) {
        this.error = '';
        try {
            const cms = this.c.get('cms');
            await cms.saveTaxonomy({ name: draft.name, label: draft.label, singular: draft.singular, hierarchical: draft.hierarchical,
                path: draft.path.trim() || null, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) }, this.c.get('principal'));
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The taxonomy could not be saved.');
        }
    }

    @Server()
    async remove() {
        try {
            await this.c.get('cms').deleteTaxonomy(this.draft.name, this.c.get('principal'));
            return this.redirect('/dashboard/taxonomies');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The taxonomy could not be deleted.');
        }
    }

    render() {
        if (!this.draft.name) return notice(this.error || __('This taxonomy does not exist.'), 'error');
        const input = (key: 'label' | 'singular' | 'description' | 'path', label: string, hint?: string) => component(Field, { label, for: `taxonomy-${key}`, ...(hint ? { hint } : {}),
            control: attributes => component(Input, { ...attributes, '.value': this.draft[key], '@input': (event: Event) => this.setDraft(key, (event.target as HTMLInputElement).value) }) });
        return html`<div class="max-w-2xl space-y-6">
            ${pageHeader(this.draft.label, { description: `${__('Taxonomy')} ${this.draft.name}`, actions: html`<a href="/dashboard/taxonomies" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Taxonomies')}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                ${input('label', __('Plural name'))}
                ${input('singular', __('Singular name'))}
                ${input('description', __('Description'))}
                ${input('path', __('URL path'), __('Archives at /<path>/<term>. Empty keeps them off the site.'))}
                <label class=${`flex items-center gap-2 text-sm ${this.draft.builtin ? 'text-muted-foreground' : 'text-foreground cursor-pointer'}`}>
                    ${component(Checkbox, { checked: this.draft.hierarchical, disabled: this.draft.builtin, '@change': (event: Event) => this.setDraft('hierarchical', (event.target as HTMLInputElement).checked) })}
                    ${__('Terms can be nested')}
                </label>
                <div class="flex items-center justify-between">
                    ${this.draft.builtin ? html`<span></span>` : html`<button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.remove()}>${__('Delete taxonomy and its terms')}</button>`}
                    ${component(Button, { type: 'submit' }, __('Save'))}
                </div>
            </form>`))}
        </div>`;
    }
}
