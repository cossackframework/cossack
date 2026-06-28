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
