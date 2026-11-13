import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { settingsRead, settingsUpdate } from '../../../../cms/manage';

/** One settings group with its values and fields: `GET /api/cms/settings/general`. */
export const GET = (c: Context) => answer(c, () => settingsRead(c, c.req.param('group') ?? ''));

/** Change some fields of a group: `PATCH /api/cms/settings/general` with `{ siteTitle: "My site" }`; the others keep their values. */
export const PATCH = (c: Context) => answer(c, body => settingsUpdate(c, c.req.param('group') ?? '', body), { write: true });
