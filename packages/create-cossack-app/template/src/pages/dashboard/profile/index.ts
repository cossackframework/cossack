import { Cossack, Page, State, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Field, Input, Button, Avatar, Form, toast } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
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
    /** Email shown in the profile card (read-only; seeded server-side). */
    @State() userEmail = '';

    async init() {
        // Seed the form server-side (serializes via @Store) so it's populated
        // at SSR — not empty until onMount runs client-side.
        const user = this.user;
        if (user) {
            this.form.name = user.name;
            this.form.avatar = user.avatar ?? '';
            this.userEmail = user.email;
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
            toast.success(__('Profile updated.'));
        } catch (e: any) {
            this.error = e?.message || 'Could not save profile';
            toast.error(this.error);
        }
    }

    @Server()
    async save(name: string, avatar: string) {
        await updateUserProfile(this.user!.id, { name, avatar: avatar || null });
    }

    render() {
        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Profile')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Update your display name and avatar.')}</p>
                </div>

                ${component(Card, {}, component(CardBody, {}, html`
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: this.form.avatar || undefined, alt: this.form.name, size: 56 })}
                        <div>
                            <div class="text-sm text-muted-foreground">${__('Email')}</div>
                            <div class="text-foreground font-medium">${this.userEmail}</div>
                        </div>
                    </div>
                `))}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Edit profile')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
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
