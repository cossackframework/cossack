import type { Context } from 'hono';
import { oauth, oauthProvider } from '../../../auth';

/** Send the visitor to the provider's consent page. A provider the project does not offer answers 404. */
export const GET = async (c: Context) => {
    const provider = c.req.param('provider') ?? '';
    if (!oauthProvider(provider)) return c.notFound();
    return oauth.redirect(provider)(c, async () => {});
};
