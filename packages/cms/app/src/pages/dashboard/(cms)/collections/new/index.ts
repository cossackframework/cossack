import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Field, IconPicker, Input, NativeSelect } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { collectionName } from '../../../../../cms/builder';
import { requireAny } from '../../../../../cms/guards';
import { ICONS } from '../../../../../cms/icons';
import { notice, pageHeader } from '../../../../../cms/ui';

/** A new collection: its names and icon; the builder takes over once it exists. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class NewCollectionPage extends Cossack {
    @State() draft = { label: '', singular: '', icon: 'box' };
    @State() error = '';

    head(): HeadValue {
        return { title: __('Add new collection') };
    }

    @Client()
    setDraft(name: 'label' | 'singular' | 'icon', value: string) {
        this.draft = { ...this.draft, [name]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.draft.label, this.draft.singular, this.draft.icon);
    }

    @Server()
    async create(label: string, singular: string, iconName: string) {
        this.error = '';
        const name = collectionName(label);
        try {
            await this.c.get('cms').saveCollection({
                name, label, singular: singular.trim() || label.trim().replace(/s$/i, ''), icon: iconName,
                path: name.replaceAll('_', '-'), slug: true, publishable: true, features: { content: true }, fields: {},
            }, this.c.get('principal'));
            return this.redirect(`/dashboard/collections/${name}?created=1`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The collection could not be created.');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Add new collection'), {
                description: __('A content type with its own list, editor and site URLs. Choose its features and attach field groups next.'),
                actions: html`<a href="/dashboard/collections" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Collections')}</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, { class: 'max-w-xl' }, component(CardBody, {}, html`
                <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                    ${component(Field, { label: __('Plural name'), for: 'collection-label', hint: this.draft.label ? `${__('Stored as')} ${collectionName(this.draft.label) || '…'}` : __('Such as Products or Events.'),
                        control: attributes => component(Input, { ...attributes, '.value': this.draft.label, '@input': (event: Event) => this.setDraft('label', (event.target as HTMLInputElement).value) }) })}
                    ${component(Field, { label: __('Singular name'), for: 'collection-singular', hint: __('Such as Product.'),
                        control: attributes => component(Input, { ...attributes, '.value': this.draft.singular, '@input': (event: Event) => this.setDraft('singular', (event.target as HTMLInputElement).value) }) })}
                    ${component(Field, { label: __('Icon'), for: 'collection-icon-picker',
                        control: () => component(IconPicker, { id: 'collection-icon', value: this.draft.icon, icons: ICONS, label: __('Icon'), allowEmpty: false, onChange: (name: string) => this.setDraft('icon', name) }) })}
                    ${component(Button, { type: 'submit', disabled: !collectionName(this.draft.label) }, __('Create collection'))}
                </form>`))}
        </div>`;
    }
}
