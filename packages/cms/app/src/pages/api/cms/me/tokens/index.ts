import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { tokenCreate, tokensList } from '../../../../../cms/manage';

/** The signed-in user's application passwords: `GET /api/cms/me/tokens`. The secrets are never listed. */
export const GET = (c: Context) => answer(c, () => tokensList(c));

/**
 * A new application password for tools such as `cossack cms`: `POST /api/cms/me/tokens` with
 * `{ name, scope: "read" | "write" }` from a signed-in session answers `{ token, id, name, scope }`;
 * the token is shown once. An application password cannot create another.
 */
export const POST = (c: Context) => answer(c, body => tokenCreate(c, body), { write: true, status: 201 });
