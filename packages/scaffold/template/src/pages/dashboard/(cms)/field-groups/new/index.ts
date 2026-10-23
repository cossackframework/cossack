import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Field, Input } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { collectionName } from '../../../../../cms/builder';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

/** A new field group: its title; the group editor takes over once it exists. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class NewFieldGroupPage extends Cossack {
    @State() title = '';
    @State() error = '';

    head(): HeadValue {
        return { title: __('Add new field group') };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.title);
    }

    @Server()
    async create(title: string) {
        this.error = '';
        const id = collectionName(title).replaceAll('_', '-');
        try {
            await this.c.get('cms').saveFieldGroup({ id, title: title.trim(), targets: [], blocks: [] }, this.c.get('principal'));
            return this.redirect(`/dashboard/field-groups/${id}?created=1`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The field group could not be created.');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Add new field group'), {
                description: __('A box of fields for editors. Lay its fields out and choose where it shows next.'),
                actions: html`<a href="/dashboard/field-groups" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Field groups')}</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, { class: 'max-w-xl' }, component(CardBody, {}, html`
                <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                    ${component(Field, { label: __('Title'), for: 'group-title', hint: this.title ? `${__('Stored as')} ${collectionName(this.title).replaceAll('_', '-') || '…'}` : __('Such as Product details.'),
                        control: attributes => component(Input, { ...attributes, '.value': this.title, '@input': (event: Event) => { this.title = (event.target as HTMLInputElement).value; } }) })}
                    ${component(Button, { type: 'submit', disabled: !collectionName(this.title) }, __('Create field group'))}
                </form>`))}
        </div>`;
    }
}
