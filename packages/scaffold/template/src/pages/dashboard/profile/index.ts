import { Cossack, Page, State, ClientState, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Field, Input, Button, Avatar, Form, toast } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { avatarUploads, updateUserProfile, uploadAvatar } from '../../../auth';
import { avatarField } from '../../../dashboard/avatar-field';

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
    /** Whether the auth store accepts picture uploads; otherwise the avatar is a URL. */
    @State() avatarUploads = false;
    @ClientState() uploading = false;
    @ClientState() avatarError = '';
    /** The chosen picture while it uploads; browser-only, so server state never echoes it back. */
    @ClientState() avatarPreview = '';

    async init() {
        // Seed the form server-side (serializes via @Store) so it's populated
        // at SSR — not empty until onMount runs client-side.
        const user = this.user;
        if (user) {
            this.form.name = user.name;
            this.form.avatar = user.avatar ?? '';
            this.userEmail = user.email;
        }
        this.avatarUploads = avatarUploads;
    }

    /** Upload a picture: it shows at once and is saved when the upload finishes. */
    @Client()
    async chooseAvatar(file: File) {
        this.avatarError = '';
        this.uploading = true;
        const preview = URL.createObjectURL(file);
        this.avatarPreview = preview;
        try {
            await this.storeAvatar(file);
            toast.success(__('Picture updated.'));
        } catch (e: any) {
            this.avatarError = e?.message || __('The picture could not be uploaded.');
        } finally {
            this.uploading = false;
            this.avatarPreview = '';
            URL.revokeObjectURL(preview);
        }
    }

    /** The stored picture's URL comes back as state. */
    @Server()
    async storeAvatar(file: File) {
        this.form.avatar = await uploadAvatar(this.user!.id, file);
    }

    @Client()
    async removeAvatar() {
        this.form.avatar = '';
        await this.clearAvatar();
        toast.success(__('Picture removed.'));
    }

    @Server()
    async clearAvatar() {
        await updateUserProfile(this.user!.id, { avatar: null });
        this.form.avatar = '';
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
                <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 class="text-2xl font-bold text-foreground">${__('Profile')}</h1>
                        <p class="mt-1 text-sm text-muted-foreground">${__('Update your display name and avatar.')}</p>
                    </div>
                    <a href="/dashboard/profile/security" class="text-sm text-primary hover:underline">${__('Security and application passwords')} →</a>
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
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('form.name'),
                                control: attributes => component(Input, { ...attributes, type: 'text', '.value': bind(this.form, 'name') }) })}
                            ${avatarField({ id: 'avatar', value: this.avatarPreview || this.form.avatar, name: this.form.name, uploads: this.avatarUploads, uploading: this.uploading, error: this.avatarError,
                                onFile: file => this.chooseAvatar(file), onUrl: url => { this.form.avatar = url; }, onRemove: () => this.removeAvatar() })}
                            ${component(Button, { type: 'submit' }, __('Save changes'))}
                            </div>
                        `)}
                    `)}
                `)}
            </div>
        `;
    }
}
