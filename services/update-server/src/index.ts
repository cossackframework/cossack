/**
 * The update server of the Cossack CMS: `GET /update?version=0.9.0&channel=latest`.
 *
 * A site sends its installed version and its channel, and nothing else. The answer names the
 * latest version of the channel. It only informs: a site's code always comes from the package
 * registry through its own project. The server sets no cookie, needs no authentication and
 * keeps no record of a request.
 */
import { compareVersions } from '@cossackframework/cms/updates';
import { updateAnswer, type ReleaseList } from './answer';
import releases from '../releases.json';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });

export function handle(request: Request, list: ReleaseList = releases as ReleaseList): Response {
    const url = new URL(request.url);
    if (url.pathname !== '/update') return json({ error: 'Not found.' }, 404, { 'cache-control': 'public, max-age=3600' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Use GET.' }, 405, { allow: 'GET, HEAD' });
    const version = url.searchParams.get('version') ?? '';
    const channel = url.searchParams.get('channel') || 'latest';
    if (version.length > 64 || compareVersions(version, version) !== 0) return json({ error: 'version must be a version such as 0.9.0.' }, 400, { 'cache-control': 'no-store' });
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) return json({ error: 'channel must be a name such as latest.' }, 400, { 'cache-control': 'no-store' });
    const answer = updateAnswer(list, version, channel);
    if (!answer) return json({ error: `No channel named ${channel}.` }, 404, { 'cache-control': 'public, max-age=300' });
    const response = json(answer, 200, { 'cache-control': 'public, max-age=3600' });
    return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
}

export default { fetch: (request: Request) => handle(request) };
