import type { Context } from 'hono';
import { handleOAuthUser, oauth, oauthProvider } from '#app/auth';

/** The provider sends the visitor back here: sign in the account it names, or create one. A provider the project does not offer answers 404. */
export const GET = async (c: Context) => {
    const provider = c.req.param('provider') ?? '';
    if (!oauthProvider(provider)) return c.notFound();
    return oauth.callback(provider, {
        onUser: (user, tokens, context) => handleOAuthUser(provider, user, tokens, context),
    })(c, async () => {});
};
