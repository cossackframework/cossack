import { Cossack, Page, State, Validate, Client, Server, Store, storeRules } from '@cossackframework/core';
import { html, component, bind } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Field, Input, Button, Alert, Checkbox, Form } from '@cossackframework/ui';
import { guard } from '../../../../services/rbac';
import { getUser, updateUser, syncUserRoles, type UserDetail } from '../../../../services/users';
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
    
    @State() saved = false;
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
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) return;
        
        try {
            await this.save();
            this.saved = true;
        } catch (e: any) {
            this.error = e?.message || __('Could not save user');
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
                            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                            ${this.saved ? component(Alert, { variant: 'success' }, __('Saved.')) : null}
                            <div class="flex flex-col space-y-6">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name') },
                                component(Input, { id: 'name', type: 'text', '.value': bind(this.userDetail, 'name') }))}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('userDetail.email') },
                                component(Input, { id: 'email', type: 'email', '.value': bind(this.userDetail, 'email') }))}
                            ${component(Field, { label: __('Avatar URL'), for: 'avatar', error: this.getError('userDetail.avatar') },
                                component(Input, { id: 'avatar', type: 'url', placeholder: 'https://...', '.value': bind(this.userDetail, 'avatar') }))}
                            <div>
                                ${component(Button, { type: 'submit' }, __('Save changes'))}
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
                                    <label class="flex items-start gap-3 cursor-pointer">
                                        ${component(Checkbox, {
                                            checked: this.assignedRoleIds.includes(role.id),
                                            '@change': (e: any) => this.toggleRole(role.id, e.target.checked),
                                        })}
                                        <span>
                                            <span class="block text-sm font-medium text-foreground">${role.name}</span>
                                            <span class="block text-xs text-muted-foreground">${role.permissions.join(', ') || __('No permissions')}</span>
                                        </span>
                                    </label>
                                `)}
                        </div>
                    `)}
                `)}
            </div>
        `;
    }
}
