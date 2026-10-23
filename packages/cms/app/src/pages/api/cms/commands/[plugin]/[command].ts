import type { Context } from 'hono';
import { commandInput, isCmsError, isSameOriginPost } from '@cossackframework/cms';

/**
 * Plugin commands (`cossack <plugin>:<command>`) run here, as the signed-in user, behind the
 * same permissions as the dashboard. Input is checked against the manifest's options.
 */
export const POST = async (c: Context) => {
    if (!isSameOriginPost(c.req.raw)) return c.json({ error: 'Forbidden', code: 'CMS_FORBIDDEN' }, 403);
    const cms = c.get('cms');
    const plugin = c.req.param('plugin') ?? '';
    const name = c.req.param('command') ?? '';
    const declared = cms.commands().find(entry => entry.plugin === plugin && entry.command.name === name);
    if (!declared) return c.json({ error: `Unknown command ${plugin}:${name}.`, code: 'CMS_NOT_FOUND' }, 404);
    let body: { input?: Record<string, unknown> };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Send a JSON body.', code: 'CMS_VALIDATION' }, 400); }
    const { values, problems } = commandInput(declared.command, body.input ?? {});
    if (problems.length) return c.json({ error: problems.join(' '), code: 'CMS_VALIDATION' }, 422);
    try {
        const result = await cms.runCommand(plugin, name, values, { principal: c.get('principal'), signal: c.req.raw.signal });
        return c.json({ result: result ?? null });
    } catch (error) {
        if (isCmsError(error)) return c.json({ error: error.message, code: error.code }, error.status as 401 | 403 | 404 | 409 | 422 | 503);
        throw error;
    }
};
