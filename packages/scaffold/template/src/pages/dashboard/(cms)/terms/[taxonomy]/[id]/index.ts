import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Field, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../../cms/ui';

interface Draft { name: string; slug: string; parent: string; description: string }

/** Edit one term. Moving it moves the terms below it too. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageTerms)] })
export default class EditTerm extends Cossack {
    @State() taxonomy = { name: '', label: '', singular: '', hierarchical: false };
    @State() draft: Draft = { name: '', slug: '', parent: '', description: '' };
    @State() parents: { id: string; name: string; depth: number }[] = [];
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() found = false;

    head(): HeadValue {
        return { title: `${__('Edit')} ${this.taxonomy.singular.toLowerCase() || __('term')}` };
    }

    async init() {
        const cms = this.c.get('cms');
        const term = await cms.taxonomies.get(this.c.req.param('id') ?? '');
        if (!term || term.taxonomy !== this.c.req.param('taxonomy')) { this.error = __('This term does not exist.'); this.c.status(404); return; }
        const declaration = cms.taxonomies.declaration(term.taxonomy);
        this.taxonomy = { name: declaration.name, label: declaration.label, singular: declaration.singular, hierarchical: declaration.hierarchical };
        this.draft = { name: term.name, slug: term.slug, parent: term.parent ?? '', description: term.description };
        if (declaration.hierarchical) {
            // A term cannot move below itself.
            this.parents = (await cms.taxonomies.tree(term.taxonomy)).filter(entry => !entry.path.startsWith(term.path)).map(entry => ({ id: entry.id, name: entry.name, depth: entry.depth }));
        }
        this.found = true;
    }

    @Client()
    setDraft(name: keyof Draft, value: string) {
        this.draft = { ...this.draft, [name]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.draft);
        if (this.error) toast.error(this.error); else toast.success(`${this.taxonomy.singular} ${__('updated.')}`);
    }

    @Server()
    async save(draft: Draft) {
        this.errors = {};
        this.error = '';
        try {
            const term = await this.c.get('cms').taxonomies.update(this.c.req.param('id') ?? '', {
                name: draft.name, slug: draft.slug, description: draft.description, ...(this.taxonomy.hierarchical ? { parent: draft.parent || null } : {}),
            }, { principal: this.c.get('principal') });
            this.draft = { name: term.name, slug: term.slug, parent: term.parent ?? '', description: term.description };
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The term could not be saved.');
        }
    }

    @Server()
    async remove() {
        try {
            await this.c.get('cms').taxonomies.delete(this.c.req.param('id') ?? '', { principal: this.c.get('principal') });
            return this.redirect(`/dashboard/terms/${this.taxonomy.name}`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The term could not be deleted.');
        }
    }

    render() {
        if (!this.found) return notice(this.error || __('This term does not exist.'), 'error');
        return html`<div class="max-w-2xl space-y-6">
            ${pageHeader(`${__('Edit')} ${this.taxonomy.singular.toLowerCase()}`, { actions: html`<a href=${`/dashboard/terms/${this.taxonomy.name}`} class="text-sm text-muted-foreground hover:text-foreground">← ${this.taxonomy.label}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                ${component(Field, { label: __('Name'), for: 'term-name', error: this.errors.name,
                    control: attributes => component(Input, { ...attributes, '.value': this.draft.name, '@input': (event: Event) => this.setDraft('name', (event.target as HTMLInputElement).value) }) })}
                ${component(Field, { label: __('Slug'), for: 'term-slug', error: this.errors.slug, hint: __('Lowercase letters, digits and hyphens. Empty derives it from the name.'),
                    control: attributes => component(Input, { ...attributes, '.value': this.draft.slug, '@input': (event: Event) => this.setDraft('slug', (event.target as HTMLInputElement).value) }) })}
                ${this.taxonomy.hierarchical ? component(Field, { label: __('Parent'), for: 'term-parent', error: this.errors.parent,
                    control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('parent', (event.target as HTMLSelectElement).value) }, html`
                        <option value="" ?selected=${!this.draft.parent}>${__('None')}</option>
                        ${this.parents.map(entry => html`<option value=${entry.id} ?selected=${entry.id === this.draft.parent}>${'— '.repeat(entry.depth)}${entry.name}</option>`)}`) }) : null}
                ${component(Field, { label: __('Description'), for: 'term-description', error: this.errors.description,
                    control: attributes => component(Textarea, { ...attributes, rows: 4, '.value': this.draft.description, '@input': (event: Event) => this.setDraft('description', (event.target as HTMLTextAreaElement).value) }) })}
                <div class="flex items-center justify-between">
                    <button type="button" class="text-sm text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.remove()}>${__('Delete')}</button>
                    ${component(Button, { type: 'submit' }, __('Update'))}
                </div>
            </form>`))}
        </div>`;
    }
}
