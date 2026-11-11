import { ClientVisibleError, Cossack, Page, Store, State, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, PasswordInput, Button, Form } from '@cossackframework/ui';
import { linkButton, notice, pageHeader } from '@cossackframework/ui/blocks';
import { html, component, bind } from '@cossackframework/renderer';
import { canAssignRoles, canGrantRoles, guard } from '../../../../services/rbac';
import { createUser } from '../../../../services/users';
import { defaultRole, listRoles, type RoleDetail } from '../../../../services/roles';
import type { PublicUser } from '../../../../auth';

interface NewUserForm {
    name: string;
    email: string;
    password: string;
    roleIds: string[];
    /** Send an invitation with a link to set the password instead of setting one here. */
    invite: boolean;
}

/**
 * Add a user. Role managers (administrators by default) choose the roles; other user managers
 * add users with the default role.
 */
@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class NewUserPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<NewUserForm>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { minLength: 8, message: 'Password must be at least 8 characters' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: NewUserForm = { name: '', email: '', password: '', roleIds: [], invite: false };

    @State() error = '';
    @State() canAssignRoles = false;
    @State() roles: RoleDetail[] = [];
    @State() defaultRoleName = '';

    async init() {
        this.canAssignRoles = canAssignRoles(this.user as PublicUser | undefined);
        const fallback = await defaultRole();
        this.defaultRoleName = fallback?.name ?? '';
        if (this.canAssignRoles) {
            this.roles = await listRoles();
            this.form.roleIds = fallback ? [fallback.id] : [];
        }
    }

    @Client()
    toggleRole(roleId: string, checked: boolean) {
        this.form.roleIds = checked ? [...new Set([...this.form.roleIds, roleId])] : this.form.roleIds.filter(id => id !== roleId);
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        const ok = await this.validateAll();
        if (!ok) return;
        if (!this.form.invite && !this.form.password) { this.error = __('Enter a password, or send an invitation.'); return; }
        try {
            await this.create(this.form.name, this.form.email, this.form.invite ? '' : this.form.password, this.form.roleIds, this.form.invite);
        } catch (e: any) {
            this.error = e?.message || __('Could not create user');
        }
    }

    @Server()
    async create(name: string, email: string, password: string, roleIds: string[], invite: boolean) {
        // Roles from the form count only for a role manager; others get the default role.
        const chosen = canAssignRoles(this.user as PublicUser | undefined) ? roleIds : undefined;
        if (chosen && !canGrantRoles(this.user as PublicUser | undefined, (await listRoles()).filter(role => chosen.includes(role.id)))) throw new ClientVisibleError(__('You cannot give a role with permissions you do not have.'));
        await createUser({ email, ...(invite ? { invite: true } : { password }), name: name || undefined, ...(chosen ? { roleIds: chosen } : {}) });
        this.redirect('/dashboard/users');
    }

    render() {
        return html`
            <div class="max-w-2xl space-y-6">
                ${pageHeader(__('New user'), { description: __('Create a new user account.') })}
                ${this.error ? notice(this.error, 'error') : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Details')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            <div class="flex flex-col space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name',
                                control: attributes => component(Input, { ...attributes, type: 'text', '.value': bind(this.form, 'name') }) })}
                            ${component(Field, { label: __('Email'), for: 'email', error: this.getError('form.email'),
                                control: attributes => component(Input, { ...attributes, type: 'email', placeholder: 'user@example.com', variant: this.hasError('form.email') ? 'error' : 'default', '.value': bind(this.form, 'email') }) })}
                            ${component(Checkbox, { label: __('Send an invitation email with a link to set the password'), checked: this.form.invite, '@change': (e: Event) => { this.form.invite = (e.target as HTMLInputElement).checked; } })}
                            ${this.form.invite ? null : component(Field, { label: __('Password'), for: 'password', error: this.getError('form.password'),
                                control: attributes => component(PasswordInput, { ...attributes, value: this.form.password, onValueChange: (v: string) => this.form.password = v }) })}
                            ${this.canAssignRoles ? html`<fieldset class="space-y-2">
                                <legend class="mb-1 text-sm font-medium text-foreground">${__('Roles')}</legend>
                                ${this.roles.length ? this.roles.map(role => html`<div>${component(Checkbox, { label: role.name, checked: this.form.roleIds.includes(role.id), '@change': (e: Event) => this.toggleRole(role.id, (e.target as HTMLInputElement).checked) })}</div>`)
                                    : html`<p class="text-sm text-muted-foreground">${__('No roles defined yet.')}</p>`}
                            </fieldset>` : html`<p class="text-sm text-muted-foreground">${this.defaultRoleName
                                ? `${__('The new user gets the default role')}: ${this.defaultRoleName}.`
                                : __('The new user starts without a role.')}</p>`}
                            <div class="flex items-center gap-2">
                                ${component(Button, { type: 'submit' }, __('Create user'))}
                                ${linkButton(__('Cancel'), '/dashboard/users', 'outline')}
                            </div>
                            </div>
                        `)}
                    `)}
                `)}
            </div>
        `;
    }
}
