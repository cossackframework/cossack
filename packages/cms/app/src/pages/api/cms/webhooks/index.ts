import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { webhookCreate, webhooksList } from '../../../../cms/manage';

/** The site's webhooks: `GET /api/cms/webhooks`. Needs the webhooks permission. */
export const GET = (c: Context) => answer(c, () => webhooksList(c));

/** A new webhook: `POST /api/cms/webhooks` with `{ name, url, events, collections?, active? }`; the answer carries the signing secret once. */
export const POST = (c: Context) => answer(c, body => webhookCreate(c, body), { write: true, status: 201 });
