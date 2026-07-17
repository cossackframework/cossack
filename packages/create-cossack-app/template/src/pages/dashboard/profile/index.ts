import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Avatar } from '@cossackframework/ui';
import { updateUserProfile } from '../../../auth';

@Page({ transport: 'http' })
export default class ProfilePage extends Cossack {
    @State()
    @Validate({ rules: { required: true, message: 'Name is required' }, config: { trigger: 'all', runOn: 'both' } })
    name = '';

    @State()
    avatar = '';

    @State() saved = false;
    @State() error = '';

    onMount() {
        const user = this.user;
        if (user) {
            this.name = user.name;
            this.avatar = user.avatar ?? '';
        }
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) { this.requestUpdate(); return; }
        try {
            await this.save(this.name, this.avatar);
            this.saved = true;
            this.requestUpdate();
        } catch (e: any) {
            this.error = e?.message || 'Could not save profile';
            this.requestUpdate();
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
                        ${component(Avatar, { src: this.avatar || user.avatar || undefined, alt: this.name || user.name, size: 56 })}
                        <div>
                            <div class="text-sm text-muted-foreground">${__('Email')}</div>
                            <div class="text-foreground font-medium">${user.email}</div>
                        </div>
                    </div>
                `))}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Edit profile')}</h2>`)}
                    <form @submit="${(e: Event) => this.handleSubmit(e)}" class="p-6 pt-0 space-y-4">
                        ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name') },
                            component(Input, { id: 'name', type: 'text', '.value': this.name, '@input': (e: any) => this.setProperty('name', e.target.value) }))}
                        ${component(Field, { label: __('Avatar URL'), for: 'avatar', hint: __('A link to your profile picture.') },
                            component(Input, { id: 'avatar', type: 'url', placeholder: 'https://...', '.value': this.avatar, '@input': (e: any) => this.setProperty('avatar', e.target.value) }))}
                        ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                        ${this.saved ? component(Alert, { variant: 'success' }, __('Profile updated.')) : null}
                        ${component(Button, { type: 'submit' }, __('Save changes'))}
                    </form>
                `)}
            </div>
        `;
    }
}
