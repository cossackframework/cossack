import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { collectionsList } from '../../../../cms/manage';

/** The site's content types with their fields: `GET /api/cms/collections`. The JSON Schema of one is at `/api/cms/schema/<collection>`. */
export const GET = (c: Context) => answer(c, async () => collectionsList(c));
