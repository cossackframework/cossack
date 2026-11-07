import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, DEFAULT_ROLES, formsModule, type Principal } from '../src/index';
import { createCMS, seedStarterContent, type CmsHost } from '../src/server/index';
import { romedbService, live } from './helpers';

describe.skipIf(!live)('starter content', () => {
    const service = romedbService();
    let cms: CmsHost;
    let admin: Principal;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule, formsModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        admin = (await cms.users.principal((await cms.users.create({ email: 'admin@example.com', name: 'Admin', roles: ['admin'] })).id))!;
    }, 60_000);

    it('seeds a post, a category, a contact form and its page once', async () => {
        expect(await seedStarterContent(cms, { principal: admin })).toEqual({ seeded: true });
        const posts = await cms.resource('cms/posts').list({}, { principal: admin });
        const pages = await cms.resource('cms/pages').list({}, { principal: admin });
        const forms = await cms.forms.all();
        const terms = (await cms.taxonomies.list('categories')).items;
        expect(posts.records.map(record => [record.title, record.slug, record.status])).toEqual([['Hello World!', 'hello-world', 'published']]);
        expect(pages.records.map(record => [record.title, record.slug, record.status])).toEqual([['Contact', 'contact', 'published']]);
        expect(forms.map(form => [form.ref.title, form.ref.slug, form.published, form.ref.inputs.map(input => input.name)])).toEqual([['Contact Form', 'contact-form', true, ['name', 'email', 'message']]]);
        expect(terms.map(term => term.slug)).toEqual(['uncategorized']);
        // The post is in the category, which is also the default for posts saved without one.
        expect(posts.records[0]!.categories).toEqual([terms[0]!.id]);
        expect(await cms.settings.get('writing.defaultCategory')).toBe(terms[0]!.id);
        // The page places the form, and the form is on the site.
        const content = pages.records[0]!.content as { type: string; data: { form?: string } }[];
        expect(content.map(block => block.type)).toEqual(['core/richtext', 'core/form']);
        expect(content[1]!.data.form).toBe('contact-form');
        expect((await cms.forms.get('contact-form'))?.published).toBe(true);
        // A site with content is left alone.
        expect(await seedStarterContent(cms, { principal: admin })).toEqual({ seeded: false });
        expect((await cms.resource('cms/posts').list({}, { principal: admin })).records).toHaveLength(1);
    });
});
