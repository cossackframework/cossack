import { Cossack, Page, State, Validate, Client, Server, Store, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Field, Input, PasswordInput, Button, Checkbox, Form, toast } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { guard } from '../../../../services/rbac';
import { getUser, updateUser, syncUserRoles, changeUserPassword, type UserDetail } from '../../../../services/users';
import { listRoles, type RoleDetail } from '../../../../services/roles';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class EditUserPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<UserDetail>({
            avatar: { required: false, url: true, message: 'Enter a valid URL' },
            name: { required: true, message: 'Name is required' },
            email: { required: true, email: true, message: 'Enter a valid email' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    userDetail: UserDetail | null = null;

    @State() assignedRoleIds: string[] = [];
    @State() allRoles: RoleDetail[] = [];
    // Renamed from `user` — `this.user` is a base-class accessor for the
    // logged-in user; redeclaring it would shadow that and break auth checks.

    /** New password typed in the "Change password" section (empty = unchanged). */
    @State() newPassword = '';

    @State() saved = '';
    @State() passwordMessage = '';
    @State() error = '';

    @Server()
    async init() {
        const id = this.c.req.param('id')!;
        const [user, roles] = await Promise.all([getUser(id), listRoles()]);
        this.allRoles = roles;
        if (!user) {
            this.error = __('User not found');
            return;
        }

        this.userDetail = user;
        this.assignedRoleIds = user.roles.map((r) => r.id);
    }

    @Client()
    toggleRole(roleId: string, checked: boolean) {
        this.assignedRoleIds = checked
            ? [...this.assignedRoleIds, roleId]
            : this.assignedRoleIds.filter((id) => id !== roleId);
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.saved = '';
        const ok = await this.validateAll();
        if (!ok) return;

        try {
            await this.save();
            this.saved = __('Saved.');
            toast.success(__('Saved.'));
        } catch (e: any) {
            this.error = e?.message || __('Could not save user');
            toast.error(this.error);
        }
    }

    @Client()
    async handleChangePassword(event: Event) {
        event.preventDefault();
        this.passwordMessage = '';
        if (this.newPassword.length < 8) {
            this.passwordMessage = __('Password must be at least 8 characters.');
            toast.warning(this.passwordMessage);
            return;
        }
        try {
            await this.applyPasswordChange(this.newPassword);
            this.newPassword = '';
            this.passwordMessage = __('Password updated.');
            toast.success(this.passwordMessage);
        } catch (e: any) {
            this.passwordMessage = e?.message || __('Could not change password');
            toast.error(this.passwordMessage);
        }
    }

    @Server()
    async save() {
        const user = this.userDetail;
        if (!user) {
            this.error = __('User not found');
            throw new Error(__('User not found'));
        }

        await updateUser(user.id, { name: user.name, email: user.email, avatar: user.avatar || null });
        await syncUserRoles(user.id, this.assignedRoleIds);
    }

    @Server()
    async applyPasswordChange(password: string) {
        const user = this.userDetail;
        if (!user) throw new Error(__('User not found'));
        await changeUserPassword(user.id, password);
    }

    render() {
        if (this.error) return html`<div class="text-sm text-destructive">${this.error}</div>`;
        if (!this.userDetail) return html`<div class="text-sm text-muted-foreground">${__('Loading user details...')}</div>`;

        return html`
            <div class="space-y-8 max-w-2xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${this.userDetail.name || this.userDetail.email}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Edit user details and roles.')}</p>
                </div>

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Profile')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            <div class="flex flex-col space-y-6">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name') },
                                component(Input, { id: 'name', type: 'text', '.value': bind(this.userDetail, 'name') }))}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email') },
                                component(Input, { id: 'email', type: 'email', '.value': bind(this.userDetail, 'email') }))}
                            ${component(Field, { label: __('Avatar URL'), for: 'avatar', error: this.getError('avatar') },
                                component(Input, { id: 'avatar', type: 'url', placeholder: 'https://...', '.value': bind(this.userDetail, 'avatar') }))}
                            <div>
                                ${component(Button, { type: 'submit' }, __('Save changes'))}
                            </div>
                            </div>
                        `)}
                    `)}
                `)}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Change password')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleChangePassword(e),
                        }, html`
                            <div class="flex flex-col space-y-4">
                                ${component(Field, { label: __('New password'), for: 'new-password', hint: __('Leave the user a way back in — they\'ll need the new password to sign in.') },
                                    component(PasswordInput, {
                                        id: 'new-password',
                                        value: this.newPassword,
                                        onChange: (v: string) => this.newPassword = v,
                                    }))}
                                <div>
                                    ${component(Button, { type: 'submit', variant: 'outline' }, __('Update password'))}
                                </div>
                            </div>
                        `)}
                    `)}
                `)}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Roles')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <div class="space-y-3">
                            ${this.allRoles.length === 0
                                ? html`<p class="text-sm text-muted-foreground">${__('No roles defined yet.')}</p>`
                                : this.allRoles.map((role) => html`
                                    <label class="flex items-center gap-3 cursor-pointer">
                                        ${component(Checkbox, {
                                            checked: this.assignedRoleIds.includes(role.id),
                                            '@change': (e: any) => this.toggleRole(role.id, e.target.checked),
                                        })}
                                        <span class="text-sm font-medium text-foreground">${role.name}</span>
                                    </label>
                                `)}
                        </div>
                        <div class="mt-6">
                            ${component(Button, { variant: 'outline', '@click': () => this.handleSubmit({ preventDefault: () => {} } as any) }, __('Save roles'))}
                        </div>
                    `)}
                `)}
            </div>
        `;
    }
}

