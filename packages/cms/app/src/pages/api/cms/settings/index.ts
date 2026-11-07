import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { settingsApply, settingsRead } from '../../../../cms/manage';

/** The settings document the caller may edit, `{ group: { field: value } }`: `GET /api/cms/settings`. The same shape Settings → Export writes. */
export const GET = (c: Context) => answer(c, () => settingsRead(c));

/** Apply a settings document, as Settings → Import does: `PUT /api/cms/settings` with `{ group: { field: value } }`. Groups left out keep their values. */
export const PUT = (c: Context) => answer(c, body => settingsApply(c, body), { write: true });
