import { Cossack, Page, State, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Avatar, Form } from '@cossackframework/ui';
import { updateUserProfile } from '../../../auth';

interface ProfileForm {
    name: string;
    avatar: string;
}

@Page({ transport: 'http' })
export default class ProfilePage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<ProfileForm>({
            name: { required: true, message: 'Name is required' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: ProfileForm = { name: '', avatar: '' };

    @State() saved = false;
    @State() error = '';

    onMount() {
        const user = this.user;
        if (user) {
            this.form.name = user.name;
            this.form.avatar = user.avatar ?? '';
        }
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.save(this.form.name, this.form.avatar);
            this.saved = true;
        } catch (e: any) {
            this.error = e?.message || 'Could not save profile';
        }
    }

    @Server()
    async save(name: string, avatar: string) {
        await updateUserProfile(this.user!.id, { name, avatar: avatar || null });
    }

    render() {
        const user = this.user!;
        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Profile')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Update your display name and avatar.')}</p>
                </div>

                ${component(Card, {}, component(CardBody, {}, html`
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: this.form.avatar || user.avatar || undefined, alt: this.form.name || user.name, size: 56 })}
                        <div>
                            <div class="text-sm text-muted-foreground">${__('Email')}</div>
                            <div class="text-foreground font-medium">${user.email}</div>
                        </div>
                    </div>
                `))}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Edit profile')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            ${this.saved ? component(Alert, { variant: 'success' }, __('Profile updated.')) : null}
                            <div class="flex flex-col space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('form.name') },
                                component(Input, { id: 'name', type: 'text', '.value': bind(this.form, 'name') }))}
                            ${component(Field, { label: __('Avatar URL'), for: 'avatar', hint: __('A link to your profile picture.') },
                                component(Input, { id: 'avatar', type: 'url', placeholder: 'https://...', '.value': bind(this.form, 'avatar') }))}
                            ${component(Button, { type: 'submit' }, __('Save changes'))}
                            </div>
                        `)}
                    `)}
                `)}
            </div>
        `;
    }
}
