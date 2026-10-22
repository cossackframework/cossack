import { CORE_BLOCKS } from '../blocks';
import { FIELD_BLOCKS } from '../field-groups';
import { pages, patterns, posts } from '../collections';
import { beforeWrite } from '../hooks';
import type { CmsModule } from '../module';
import { discussion, languages, reading, seo, writing } from '../settings';
import type { TaxonomyDeclaration } from '../taxonomy';

export { CONTENT_STATUSES, pages, patterns, posts, type ContentStatus } from '../collections';

/** Hierarchical categories and flat tags for posts. */
export const categories: TaxonomyDeclaration = { name: 'categories', label: 'Categories', singular: 'Category', hierarchical: true, path: 'category', builtin: true };
export const tags: TaxonomyDeclaration = { name: 'tags', label: 'Tags', singular: 'Tag', hierarchical: false, path: 'tag', builtin: true };

/**
 * The built-in content module: posts, pages and patterns, categories and tags, the core blocks,
 * and Writing, Reading, Discussion, SEO and Languages settings. In every publishable collection,
 * publishing without a time publishes now; publishing with a future time schedules the entry,
 * and a scheduled entry whose time has come is published. New entries take the default
 * language. A post saved without a category gets the Writing settings' default category.
 */
export const contentModule: CmsModule = {
    owner: 'cms',
    resources: [],
    collections: [posts, pages, patterns],
    taxonomies: [categories, tags],
    blocks: [...CORE_BLOCKS, ...FIELD_BLOCKS],
    settings: [writing, reading, discussion, seo, languages],
    register({ hooks, settings, taxonomies, collection, now }) {
        hooks.addFilter(beforeWrite, async (draft, { input }) => {
            if (!input.resource.startsWith('cms/')) return draft;
            let next = draft;
            const status = draft.status ?? input.previous?.status;
            let publishedAt = 'publishedAt' in draft ? draft.publishedAt : input.previous?.publishedAt ?? null;
            const at = now();
            if ((status === 'published' || status === 'scheduled') && (publishedAt === null || publishedAt === undefined)) {
                publishedAt = at;
                next = { ...next, publishedAt: at };
            }
            if (status === 'published' && typeof publishedAt === 'number' && publishedAt > at) next = { ...next, status: 'scheduled' };
            else if (status === 'scheduled' && typeof publishedAt === 'number' && publishedAt <= at) next = { ...next, status: 'published' };
            if (input.action === 'create' && (draft.locale === undefined || draft.locale === null)) {
                const locale = (await settings.all())['languages.default'];
                if (typeof locale === 'string' && locale) next = { ...next, locale };
            }
            if (input.action === 'create' && draft.commentsOpen === undefined && collection(input.resource.slice(4))?.comments) {
                next = { ...next, commentsOpen: (await settings.all())['discussion.defaultOpen'] };
            }
            const assigned = 'categories' in draft ? draft.categories : input.action === 'create' ? [] : undefined;
            if (input.resource === 'cms/posts' && Array.isArray(assigned) && assigned.length === 0) {
                const fallback = (await settings.all())['writing.defaultCategory'];
                if (fallback && (await taxonomies.get(fallback))?.taxonomy === 'categories') next = { ...next, categories: [fallback] };
            }
            return next;
        }, { plugin: 'cms', priority: 5 });
    },
};
