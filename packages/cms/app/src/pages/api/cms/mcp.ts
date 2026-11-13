import type { Context } from 'hono';
import { handleMcp } from '../../../cms/mcp';
import { cmsTools, siteInstructions, toolError } from '../../../cms/mcp-tools';

const UNAUTHENTICATED = { error: 'Send an application password: Authorization: Bearer cms_… (Profile → Application passwords, or cossack cms login).', code: 'CMS_UNAUTHENTICATED' };

/**
 * The site's MCP server: `POST /api/cms/mcp`, Streamable HTTP without sessions, for MCP
 * clients such as Claude, Cursor and `cossack cms mcp`. It signs in with an application
 * password alone (`Authorization: Bearer cms_…`), never a session cookie; a read-only password
 * lists and runs the reading tools only. On the network host, `?site=<id>` (or the
 * `X-Cossack-Site` header) serves another site.
 */
export const POST = async (c: Context) => {
    if (c.get('principal').kind !== 'user' || !c.get('cms.token')) return c.json(UNAUTHENTICATED, 401, { 'www-authenticate': 'Bearer realm="cossack-cms"' });
    return handleMcp(c.req.raw, {
        name: 'cossack-cms', version: '1', instructions: await siteInstructions(c),
        tools: cmsTools, context: { c }, readOnly: c.get('cms.tokenScope') === 'read', toolError,
    });
};

/** No server-initiated streams: 405. */
export const GET = async (c: Context) => {
    if (c.get('principal').kind !== 'user' || !c.get('cms.token')) return c.json(UNAUTHENTICATED, 401, { 'www-authenticate': 'Bearer realm="cossack-cms"' });
    return handleMcp(c.req.raw, { name: 'cossack-cms', version: '1', tools: [], context: { c } });
};

/** No sessions to end: 405. */
export const DELETE = GET;
