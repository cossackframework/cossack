/**
 * Counting what crawlers fetch and what visitors miss, in the background of a request so
 * pages never wait on the write. Server-only.
 */
import type { Context } from 'hono';
import type { VisitKind } from '@cossackframework/cms/server';

function later(c: Context, work: Promise<unknown>): void {
    const settled = work.catch(error => console.error('[cms] traffic could not be recorded', error));
    try { c.executionCtx.waitUntil(settled); } catch { /* Node keeps running the promise. */ }
}

/** Count the request when a known crawler made it. */
export function trackCrawler(c: Context, kind: VisitKind): void {
    const agent = c.req.header('user-agent') ?? '';
    const cms = c.get('cms');
    if (!cms || !agent || !/bot|spider|crawl|slurp|-user\b|ChatGPT|Claude|Perplexity|Diffbot|Google|Bytespider|Amazonbot/i.test(agent)) return;
    later(c, cms.traffic.recordVisit(agent, kind));
}

/** Record a page path that answered 404, with its referrer. */
export function trackNotFound(c: Context): void {
    const cms = c.get('cms');
    if (!cms || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return;
    later(c, cms.traffic.recordNotFound(c.req.path, c.req.header('referer')));
}
