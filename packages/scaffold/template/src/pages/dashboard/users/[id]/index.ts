import { ClientVisibleError, Cossack, Page, State, ClientState, Validate, Client, Server, Store, storeRules } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Field, Input, PasswordInput, Button, Checkbox, Form, Tabs, toast } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { canAssignRoles, canManageUser, canManageAccess, guard } from '../../../../services/rbac';
import { getUser, updateUser, syncUserRoles, changeUserPassword, type UserDetail } from '../../../../services/users';
import { listRoles, type RoleDetail } from '../../../../services/roles';
import {
    apiTokensAvailable, avatarUploads, createApiToken, listApiTokens, resetSecondFactors, revokeApiToken, revokeSessionOf, revokeSessionsOf, securityStatus, sessionsOf,
    twoFactorAvailable, uploadAvatar, type ApiToken, type PublicUser, type SessionInfo,
} from '../../../../auth';
import { AppPasswords } from '../../../../dashboard/app-passwords';
import { avatarField } from '../../../../dashboard/avatar-field';
import { sessionTable } from '../../../../dashboard/session-list';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class EditUserPage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<UserDetail>({
            name: { required: true, message: 'Name is required' },
            email: { required: true, email: true, message: 'Enter a valid email' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    userDetail: UserDetail | null = null;

    @State() assignedRoleIds: string[] = [];
    @State() allRoles: RoleDetail[] = [];
    /** Only role managers (administrators by default) see and change roles. */
    @State() canAssignRoles = false;
    /** Accounts that can manage roles are read-only for other user managers. */
    @State() readOnly = false;
    @State() avatarUploads = false;
    @ClientState() uploading = false;
    @ClientState() avatarError = '';
    /** The chosen picture while it uploads; browser-only, so server state never echoes it back. */
    @ClientState() avatarPreview = '';
    // Renamed from `user` — `this.user` is a base-class accessor for the
    // logged-in user; redeclaring it would shadow that and break auth checks.

    /** New password typed in the "Change password" section (empty = unchanged). */
    @State() newPassword = '';

    @State() saved = '';
    @State() passwordMessage = '';
    @State() error = '';
    /** The user's second factors: an authenticator app and how many passkeys. */
    @State() security: { available: boolean; totp: boolean; passkeys: number } = { available: false, totp: false, passkeys: 0 };
    /** The Sessions and Application passwords tabs show to the user and to administrators only. */
    @State() canSeeAccess = false;
    @State() sessions: SessionInfo[] = [];
    @State() sessionsError = '';
    @State() tokensAvailable = false;
    @State() tokens: ApiToken[] = [];
    /** A password just created for this user, shown once. */
    @State() newToken = '';
    @State() tokensError = '';
    /** The open tab; `?tab=sessions` or `?tab=passwords` opens that one. */
    @State() tab = 'profile';

    @Server()
    async init() {
        const id = this.c.req.param('id')!;
        this.canAssignRoles = canAssignRoles(this.user as PublicUser | undefined);
        this.avatarUploads = avatarUploads;
        const [user, roles] = await Promise.all([getUser(id), this.canAssignRoles ? listRoles() : Promise.resolve([])]);
        this.allRoles = roles;
        if (!user) {
            this.error = __('User not found');
            return;
        }

        this.userDetail = user;
        this.assignedRoleIds = user.roles.map((r) => r.id);
        this.readOnly = !canManageUser(this.user as PublicUser | undefined, user);
        if (twoFactorAvailable) {
            const status = await securityStatus(id);
            this.security = { available: true, totp: status.totp, passkeys: status.passkeys.length };
        }
        this.canSeeAccess = canManageAccess(this.user as PublicUser | undefined, id);
        if (this.canSeeAccess) {
            this.sessions = await sessionsOf(this.c, id);
            this.tokensAvailable = apiTokensAvailable;
            if (this.tokensAvailable) this.tokens = await listApiTokens(id);
            const tab = this.c.req.query('tab');
            if (tab === 'sessions' || (tab === 'passwords' && this.tokensAvailable)) this.tab = tab;
        }
    }

    // --- Sessions ----------------------------------------------------------------

    /** Server methods check again who may see the sessions and passwords; the caller's own session stays. */
    private accessOwner(): string {
        const id = this.c.req.param('id')!;
        if (!canManageAccess(this.user as PublicUser | undefined, id)) throw new ClientVisibleError(__('Only the user and administrators can manage this.'));
        return id;
    }

    @Server()
    async endSession(reference: string) {
        const id = this.accessOwner();
        this.sessionsError = (await revokeSessionOf(this.c, id, reference)) ? '' : __('The session could not be ended.');
        this.sessions = await sessionsOf(this.c, id);
    }

    @Server()
    async endOtherSessions() {
        const id = this.accessOwner();
        await revokeSessionsOf(this.c, id);
        this.sessionsError = '';
        this.sessions = await sessionsOf(this.c, id);
    }

    // --- Application passwords -------------------------------------------------------

    /** An administrator's password for another user acts as that user. Returns whether it was created. */
    @Server()
    async addToken(name: string, scope: 'read' | 'write'): Promise<boolean> {
        const id = this.accessOwner();
        this.tokensError = '';
        try {
            this.newToken = await createApiToken(id, name, scope === 'read' ? 'read' : 'write');
            this.tokens = await listApiTokens(id);
            return true;
        } catch (error) {
            this.tokensError = (error as Error).message;
            return false;
        }
    }

    @Server()
    async deleteToken(tokenId: string) {
        const id = this.accessOwner();
        await revokeApiToken(id, tokenId);
        this.tokens = await listApiTokens(id);
    }

    @Client()
    showTab(value: string) {
        this.tab = value;
        // Keep the tab in the address so a reload or a shared link opens it.
        const url = new URL(window.location.href);
        if (value === 'profile') url.searchParams.delete('tab');
        else url.searchParams.set('tab', value);
        window.history.replaceState(window.history.state, '', url);
    }

    /** For someone who lost their phone or security key: they sign in with the password alone again. */
    @Server()
    async resetSecurity() {
        const id = await this.editable();
        await resetSecondFactors(id);
        this.security = { ...this.security, totp: false, passkeys: 0 };
    }

    /** Server methods load the account again and refuse when the signed-in user may not change it. */
    private async editable(): Promise<string> {
        const id = this.c.req.param('id')!;
        const target = await getUser(id);
        if (!target) throw new ClientVisibleError(__('User not found'));
        if (!canManageUser(this.user as PublicUser | undefined, target)) throw new ClientVisibleError(__('Only an administrator can change this account.'));
        return id;
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
        if (user.id !== await this.editable()) throw new ClientVisibleError(__('User not found'));

        await updateUser(user.id, { name: user.name, email: user.email, avatar: user.avatar || null });
        // The client sends its roles with every save; only a role manager's are applied.
        if (canAssignRoles(this.user as PublicUser | undefined)) await syncUserRoles(user.id, this.assignedRoleIds);
    }

    /** Upload a picture for this user: it shows at once and is saved when the upload finishes. */
    @Client()
    async chooseAvatar(file: File) {
        if (!this.userDetail) return;
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
        const url = await uploadAvatar(await this.editable(), file);
        if (this.userDetail) this.userDetail.avatar = url;
    }

    @Client()
    async removeAvatar() {
        if (!this.userDetail) return;
        this.userDetail.avatar = null;
        await this.clearAvatar();
        toast.success(__('Picture removed.'));
    }

    @Server()
    async clearAvatar() {
        await updateUser(await this.editable(), { avatar: null });
        if (this.userDetail) this.userDetail.avatar = null;
    }

    @Server()
    async applyPasswordChange(password: string) {
        const user = this.userDetail;
        if (!user) throw new Error(__('User not found'));
        await changeUserPassword(await this.editable(), password);
    }

    render() {
        if (this.error) return html`<div class="text-sm text-destructive">${this.error}</div>`;
        if (!this.userDetail) return html`<div class="text-sm text-muted-foreground">${__('Loading user details...')}</div>`;
        if (this.readOnly) return html`<div class="space-y-4 max-w-2xl">
            <h1 class="text-2xl font-bold text-foreground">${this.userDetail.name || this.userDetail.email}</h1>
            <p role="status" class="rounded-md border border-border px-3 py-2 text-sm text-foreground">${__('Only an administrator can change this account.')}</p>
            <a href="/dashboard/users" class="text-sm text-primary hover:underline">← ${__('All users')}</a>
        </div>`;

        const profile = html`<div class="space-y-8 max-w-2xl">
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Profile')}</h2>`)}
                ${component(CardBody, {}, html`
                    ${component(Form, {
                        submit: (e: Event) => this.handleSubmit(e),
                    }, html`
                        <div class="flex flex-col space-y-6">
                        ${component(Field, { label: __('Name'), for: 'name', error: this.getError('name'),
                            control: attributes => component(Input, { ...attributes, type: 'text', '.value': bind(this.userDetail, 'name') }) })}
                        ${component(Field, { label: __('Email'), for: 'email', error: this.getError('email'),
                            control: attributes => component(Input, { ...attributes, type: 'email', '.value': bind(this.userDetail, 'email') }) })}
                        ${avatarField({ id: 'avatar', value: this.avatarPreview || this.userDetail.avatar || '', name: this.userDetail.name || this.userDetail.email, uploads: this.avatarUploads,
                            uploading: this.uploading, error: this.avatarError, onFile: file => this.chooseAvatar(file),
                            onUrl: url => { if (this.userDetail) this.userDetail.avatar = url; }, onRemove: () => this.removeAvatar() })}
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
                            ${component(Field, { label: __('New password'), for: 'new-password', hint: __('Leave the user a way back in — they\'ll need the new password to sign in.'),
                                control: attributes => component(PasswordInput, {
                                    ...attributes,
                                    value: this.newPassword,
                                    onValueChange: (v: string) => this.newPassword = v,
                                }) })}
                            <div>
                                ${component(Button, { type: 'submit', variant: 'outline' }, __('Update password'))}
                            </div>
                        </div>
                    `)}
                `)}
            `)}

            ${this.security.available ? component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Two-step sign-in')}</h2>`)}
                ${component(CardBody, { class: 'space-y-3' }, html`
                    <p class="text-sm text-muted-foreground">${this.security.totp || this.security.passkeys
                        ? `${this.security.totp ? __('Authenticator app on.') : __('No authenticator app.')} ${this.security.passkeys} ${this.security.passkeys === 1 ? __('passkey') : __('passkeys')}.`
                        : __('This user signs in with a password only.')}</p>
                    ${this.security.totp || this.security.passkeys ? component(Button, { type: 'button', variant: 'outline', '@click': async () => { await this.resetSecurity(); toast.success(__('Two-step sign-in reset.')); } }, __('Reset two-step sign-in')) : null}
                `)}
            `) : null}

            ${this.canAssignRoles ? component(Card, {}, html`
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
            `) : null}
        </div>`;
        const own = this.userDetail.id === this.user?.id;
        const sessions = html`<div class="space-y-4">
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Active sessions')}</h2>
                    <p class="mt-1 text-sm text-muted-foreground">${own ? __('Devices signed in to your account.') : __('Devices signed in to this account.')}</p>`)}
                ${component(CardBody, {}, html`
                    ${this.sessionsError ? html`<p role="alert" class="mb-3 text-sm text-destructive">${this.sessionsError}</p>` : null}
                    ${sessionTable(this.sessions, { id: 'user-sessions', onRevoke: async (reference) => { await this.endSession(reference); if (!this.sessionsError) toast.success(__('Session ended.')); } })}`)}
            `)}
            ${this.sessions.some((session) => !session.current) ? html`<div class="flex justify-end">
                ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': async () => { await this.endOtherSessions(); toast.success(__('Signed out.')); } },
                    own ? __('Sign out other sessions') : __('Sign out everywhere'))}
            </div>` : null}
        </div>`;

        const passwords = html`<div class="max-w-3xl">
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Application passwords')}</h2>
                    <p class="mt-1 text-sm text-muted-foreground">${own
                        ? __('Let apps and scripts use the content API as you: send the password as Authorization: Bearer.')
                        : __('Apps and scripts using these act as this user, with the user\'s roles. Create one for an integration account, then hand it to the app.')}</p>`)}
                ${component(CardBody, { class: 'space-y-3' }, html`
                    ${this.tokensError ? html`<p role="alert" class="text-sm text-destructive">${this.tokensError}</p>` : null}
                    ${component(AppPasswords, { tokens: this.tokens, newToken: this.newToken,
                        onAdd: (name: string, scope: 'read' | 'write') => this.addToken(name, scope), onRevoke: (tokenId: string) => this.deleteToken(tokenId) })}`)}
            `)}
        </div>`;

        return html`
            <div class=${`space-y-8 ${this.canSeeAccess ? 'max-w-4xl' : 'max-w-2xl'}`}>
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${this.userDetail.name || this.userDetail.email}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${this.canAssignRoles ? __('Edit user details and roles.') : __('Edit user details.')}</p>
                </div>

                ${this.canSeeAccess
                    ? component(Tabs, {
                          id: 'user-tabs', label: __('User'), value: this.tab, variant: 'underline',
                          onValueChange: (value: string) => this.showTab(value),
                          items: [
                              { value: 'profile', label: __('Profile'), content: profile },
                              { value: 'sessions', label: `${__('Sessions')} (${this.sessions.length})`, content: sessions },
                              ...(this.tokensAvailable ? [{ value: 'passwords', label: `${__('Application passwords')} (${this.tokens.length})`, content: passwords }] : []),
                          ],
                      })
                    : profile}
            </div>
        `;
    }
}

