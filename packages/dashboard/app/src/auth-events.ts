// What happens around sign-in besides sign-in itself. Nothing here; a package that serves
// these pages with more to do (the CMS: plugin hooks, outbox events) replaces this module.

export interface AuthUserRef { id: string; email: string; name: string }

export const authEvents = {
  /**
   * Before a visitor's registration makes an account: return the name to use, or throw a
   * `ClientVisibleError` to refuse it.
   */
  async beforeRegister(draft: { email: string; name: string }): Promise<{ name: string }> {
    return { name: draft.name };
  },
  /** After a registration made an account (it may still wait for confirmation or approval). */
  async registered(_user: AuthUserRef): Promise<void> {},
  /** After a session was made for the user on this host. */
  async signedIn(_user: { id: string }): Promise<void> {},
};
