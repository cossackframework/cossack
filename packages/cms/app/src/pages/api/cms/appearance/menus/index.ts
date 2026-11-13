import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { menuCreate, menusList } from '../../../../../cms/manage';

/** The site's menus with how many items each has and where it shows: `GET /api/cms/appearance/menus`. Needs the appearance permission. */
export const GET = (c: Context) => answer(c, () => menusList(c));

/**
 * A new menu: `POST /api/cms/appearance/menus` with `{ name, items?, locations? }`. Items are a
 * tree (`kind`, `label`, the target, `description`, `panel`, `children`, …) and may leave out
 * their IDs; `locations` names the theme locations the menu shows in.
 */
export const POST = (c: Context) => answer(c, body => menuCreate(c, body), { write: true, status: 201 });
