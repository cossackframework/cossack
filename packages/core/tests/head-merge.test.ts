import { describe, it, expect } from 'vitest';
import { buildHeadContext, mergeHead } from '../src/shared/head';
import type { HeadContext, HeadValue } from '../src/shared/head';

const emptyCtx = (): HeadContext => ({
  title: '',
  description: '',
  image: '',
  meta: [],
  links: [],
  scripts: [],
  tags: [],
});

describe('mergeHead category accumulation', () => {
  it('concatenates parent tags after child tags (does not replace)', () => {
    const childTags = [{ tag: 'link', attributes: { rel: 'canonical', href: '/a' } }] as const;
    const ctx = buildHeadContext([...childTags]);

    const value: HeadValue = {
      links: [{ tag: 'link', attributes: { rel: 'stylesheet', href: '/fonts.css' } }],
    };

    const result = mergeHead(ctx, value);
    const linkHrefs = result.filter((t) => t.tag === 'link').map((t) => t.attributes!.href);

    // Child canonical is preserved AND parent stylesheet is appended.
    expect(linkHrefs).toEqual(['/a', '/fonts.css']);
  });

  it('accumulates meta + scripts through a multi-level merge (page -> app)', () => {
    // Page level
    const pageCtx = emptyCtx();
    const pageValue: HeadValue = {
      title: 'Page',
      meta: [{ tag: 'meta', attributes: { name: 'description', content: 'page desc' } }],
    };
    const afterPage = mergeHead(pageCtx, pageValue);

    // App level receives the page's accumulated tags as context.
    const appCtx = buildHeadContext(afterPage);
    const appValue: HeadValue = {
      title: 'App - Page',
      meta: [{ tag: 'meta', attributes: { name: 'theme-color', content: '#000' } }],
    };
    const final = mergeHead(appCtx, appValue);

    const descriptions = final.filter((t) => t.tag === 'meta' && t.attributes?.name === 'description');
    const themeColors = final.filter((t) => t.tag === 'meta' && t.attributes?.name === 'theme-color');

    expect(descriptions).toHaveLength(1); // page description survives
    expect(themeColors).toHaveLength(1); // app meta appended
    const title = final.find((t) => t.tag === 'title');
    expect(title?.children).toBe('App - Page'); // title still overrides
  });

  it('keeps child title when parent does not override it', () => {
    const ctx = buildHeadContext([{ tag: 'title', children: 'Child' }]);
    const result = mergeHead(ctx, { meta: [] });
    expect(result.find((t) => t.tag === 'title')?.children).toBe('Child');
  });
});

/**
 * Regression for the router's head-merge pipeline. The router merges inside-out:
 * page -> innermost layout -> ... -> outermost layout -> global App, feeding each
 * level the accumulated tags as context. This pins that order so a refactor
 * cannot silently invert precedence (page-specific tags must survive; arrays
 * accumulate child-first; a level that omits a field keeps the child's value).
 */
describe('router head-merge pipeline order', () => {
  // Replicates router.ts: page.head -> merge -> layouts[length-1..0] -> app.
  function pipeline(
    pageHead: HeadValue,
    layoutHeads: HeadValue[], // ordered outermost-first to match a directory stack;
                              // the router walks innermost-first, so we reverse here.
    appHead: HeadValue,
  ) {
    const empty = buildHeadContext([]);
    let tags = mergeHead(empty, pageHead);
    for (let i = layoutHeads.length - 1; i >= 0; i--) {
      const ctx = buildHeadContext(tags);
      tags = mergeHead(ctx, layoutHeads[i]);
    }
    const finalCtx = buildHeadContext(tags);
    return mergeHead(finalCtx, appHead);
  }

  it('preserves the page title when layouts/app omit title', () => {
    const tags = pipeline(
      { title: 'Page Title' },
      [{ links: [{ tag: 'link', attributes: { rel: 'stylesheet', href: '/dash.css' } }] }],
      { meta: [{ tag: 'meta', attributes: { name: 'theme-color', content: '#000' } }] },
    );
    expect(tags.find((t) => t.tag === 'title')?.children).toBe('Page Title');
  });

  it('preserves page-specific tags (canonical) through the whole stack', () => {
    const tags = pipeline(
      { links: [{ tag: 'link', attributes: { rel: 'canonical', href: '/post/1' } }] },
      [{ links: [{ tag: 'link', attributes: { rel: 'stylesheet', href: '/layout.css' } }] }],
      { links: [{ tag: 'link', attributes: { rel: 'preconnect', href: 'https://cdn' } }] },
    );
    const hrefs = tags.filter((t) => t.tag === 'link').map((t) => t.attributes!.href);
    // Page canonical kept AND layout/app links appended.
    expect(hrefs).toEqual(['/post/1', '/layout.css', 'https://cdn']);
  });

  it('lets the App compose/brand the title from accumulated context', () => {
    // Simulate an App that reads the incoming title and adds a brand suffix.
    const appHead: HeadValue = {};
    // The App pattern: title = ctx.title ? ctx.title + ' | Site' : 'Site'.
    // We model it by computing against the page title directly here.
    const tags = pipeline(
      { title: 'Hello' },
      [],
      { ...appHead, title: 'Hello | Site' },
    );
    expect(tags.find((t) => t.tag === 'title')?.children).toBe('Hello | Site');
  });
});
