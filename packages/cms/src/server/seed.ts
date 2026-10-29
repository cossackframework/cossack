/**
 * Starter content for a new site, as WordPress ships a first post and page: a "Hello World!"
 * post in an "Uncategorized" category, a "Contact Form" form and a "Contact" page that places
 * it. Seeded once at setup; a site that already has entries is left alone.
 */
import type { Block } from '../blocks';
import { richTextFromPlain } from '../richtext';
import type { Principal } from '../permissions';
import type { CmsHost } from './host';

export interface SeedReport {
    /** Whether anything was created; false when the site already had content. */
    readonly seeded: boolean;
}

const input = (id: string, kind: string, data: { [key: string]: unknown }): Block => ({ _id: id, type: `form/${kind}`, data });

/** Create the starter content when the site has no posts, pages or forms. */
export async function seedStarterContent(cms: CmsHost, context: { principal: Principal }): Promise<SeedReport> {
    const { principal } = context;
    const has = async (resource: string) => cms.resourceById(resource) ? (await cms.resource(resource).list({ limit: 1 }, { principal })).records.length > 0 : true;
    if (await has('cms/posts') || await has('cms/pages') || await has('cms/forms')) return { seeded: false };

    const category = await cms.taxonomies.create('categories', { name: 'Uncategorized', slug: 'uncategorized' }, { principal });
    await cms.settings.update('writing', { defaultCategory: category.id }, { principal });

    const form = await cms.resource('cms/forms').create({
        title: 'Contact Form', slug: 'contact-form', status: 'published',
        body: [
            input('name', 'text', { name: 'name', label: 'Your name', required: true }),
            input('email', 'email', { name: 'email', label: 'Email', required: true }),
            input('message', 'textarea', { name: 'message', label: 'Message', required: true }),
        ],
        settings: { submitLabel: 'Send', message: 'Thanks! We received your message and will reply soon.' },
        notifications: { rules: [{ id: 'admin', label: 'Admin notification', to: '{admin_email}', subject: 'New message from {field:name}', body: '{all_fields}\n\n{submission:url}', replyTo: '{field:email}' }] },
    }, { principal });

    await cms.resource('cms/pages').create({
        title: 'Contact', slug: 'contact', status: 'published',
        content: [
            { _id: 'intro', type: 'core/richtext', data: { text: richTextFromPlain('Have a question? Send us a message and we will get back to you.') } },
            { _id: 'form', type: 'core/form', data: { form: String(form.slug) } },
        ],
    }, { principal });

    await cms.resource('cms/posts').create({
        title: 'Hello World!', slug: 'hello-world', status: 'published', categories: [category.id],
        excerpt: 'Welcome to your new site. This is your first post: edit or delete it, then start writing.',
        content: [{ _id: 'intro', type: 'core/richtext', data: { text: richTextFromPlain('Welcome to your new site. This is your first post. Edit or delete it, then start writing!') } }],
    }, { principal });
    return { seeded: true };
}
