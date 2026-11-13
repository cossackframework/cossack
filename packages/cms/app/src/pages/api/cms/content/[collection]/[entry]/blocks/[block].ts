import type { Context } from 'hono';
import { CmsError } from '@cossackframework/cms';
import { answer, apiHeaders } from '../../../../../../../cms/content-api';
import { entryBlock } from '../../../../../../../cms/manage';

/**
 * One block of an entry by its ID: `GET /api/cms/content/posts/hello-world/blocks/hero`. Editors
 * give a block an ID of their own under its Style tab → Advanced → Block ID; nested blocks and
 * blocks embedded in rich text are found too. The answer names the field the block sits in.
 */
export const GET = (c: Context) => answer(c, async () => {
    const found = await entryBlock(c, c.req.param('collection') ?? '', c.req.param('entry') ?? '', c.req.param('block') ?? '');
    if (!found) throw new CmsError('CMS_NOT_FOUND', 'Block not found.');
    apiHeaders(c);
    return found;
});
