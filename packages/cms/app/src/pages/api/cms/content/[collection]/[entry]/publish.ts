import type { Context } from 'hono';
import { answer } from '../../../../../../cms/content-api';
import { entryPublish } from '../../../../../../cms/manage';

/**
 * Publish an entry: `POST /api/cms/content/posts/<id>/publish` with an optional `at` (ISO 8601;
 * a future time schedules it) and `rev` (the revision you read; the current one when left out).
 * An entry published before keeps its publication time unless `at` is given. With "Open notes
 * hold publishing" on, open notes refuse it with 422.
 */
export const POST = (c: Context) => answer(c, body => entryPublish(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', body), { write: true });
