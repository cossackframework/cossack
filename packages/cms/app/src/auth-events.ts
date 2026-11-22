// What the CMS does around sign-in, for the shared sign-in code (auth.ts): plugins have a say
// in a registration (`cms.user.before-register`), and the site hears of registrations and
// sign-ins (`cms.user.registered`, `cms.user.signed-in`, through the outbox).
import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import { currentCms } from './cms/index';

export interface AuthUserRef { id: string; email: string; name: string }

export const authEvents = {
  async beforeRegister(draft: { email: string; name: string }): Promise<{ name: string }> {
    const cms = currentCms();
    const c = getRequestContext();
    try {
      const settings = await cms.settings.all();
      const role = settings['general.defaultRole'];
      const result = await cms.registrationDraft({ email: draft.email, name: draft.name.trim() || draft.email.split('@')[0]!, roles: role && (await cms.users.role(role)) ? [role] : [], approval: settings['general.approveRegistrations'] === true },
        { origin: c ? new URL(c.req.url).origin : '' });
      return { name: result.name };
    } catch (error) {
      if (isCmsError(error)) throw new ClientVisibleError(error.message);
      throw error;
    }
  },
  async registered(user: AuthUserRef): Promise<void> {
    await currentCms().userRegistered(user, 'active').catch(() => undefined);
  },
  async signedIn(user: { id: string }): Promise<void> {
    const cms = currentCms();
    const member = await cms.users.get(user.id).catch(() => null);
    if (member) await cms.userSignedIn({ id: member.id, email: member.email, name: member.name }, '').catch(() => undefined);
  },
};
