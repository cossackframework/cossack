import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { webhookDelete } from '../../../../cms/manage';

/** Remove a webhook: `DELETE /api/cms/webhooks/<id>`. */
export const DELETE = (c: Context) => answer(c, () => webhookDelete(c, c.req.param('id') ?? ''), { write: true });
